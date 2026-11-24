import type { RemoteSleepOutcome } from "../../types/daemon.js";
import type { LaneSleep } from "./lane.js";
import { recordMachine, updateMachine } from "./machines-store.js";
import { type MachineRequest, type RemoteMachine, recordOf } from "./provider.js";
import { providerOf } from "./providers/index.js";
import { idleSleepMinutesOf, type RemoteLane } from "./settings.js";
import { closeMaster, controlSocket, multiplexed, type SshTarget } from "./ssh.js";

/*
 * Spec 026 D6, D7, D8 (rows 026-10, 026-11): one worktree's remote machine,
 * shared by every lane that goes there: each runner's (Vitest, each
 * node:test and pytest project), and each slow or group lane's per pass.
 * The first lane to connect acquires it and records it in
 * `remote-machines.json`; the others reach the same machine, over one ssh
 * connection while it is awake (`ssh.ts`, a ControlMaster). It is woken
 * only after Squeal put it to sleep or a lane lost it, and released once,
 * at the daemon's exit.
 *
 * Sleep (D12.4, B7) takes every lane: none may have a remote run or a
 * connect in flight; then each closes its channel, the shared connection
 * ends, and the machine is asked to sleep once and recorded once. D7.3:
 * after `idleSleepMinutes` with no remote run, connect or invalidation on
 * any lane, the machine sleeps so; the next remote run wakes it. A machine
 * that does not sleep when idle (a static host) has its idle channels
 * closed then, and is never recorded sleeping. The idle timer never holds
 * the daemon up; no ssh keepalive outlives it (`ControlPersist` is the
 * idle time).
 *
 * Review 0.1.617 B1: the daemon's exit starts no further work on the
 * machine. A queued `serial` work and a later `reach` are refused; an
 * acquire, wake, sleep or `serial` work in flight is waited for. Only then
 * does the shared connection end and the machine get released, once.
 *
 * Review 0.1.619 B3 (spec 026 D8.4): a machine whose tree keeps `.git`
 * counts as a Git repository only while that `.git` is at the worktree's
 * Git state (`gitCurrent`). Before a lane splits a tier, `refreshGit` reads
 * that state here; only when it moved does it reach the machine, as
 * `serial` work, so the exit waits for it or refuses it.
 */

/** What the machine asks of each lane on it: whether it may sleep, and its sleep (`RemoteLaneRunner`). */
export interface SharedLane {
  busy(): string | null;
  sleep(machineSleep: () => Promise<void>): Promise<LaneSleep>;
}

export interface MachineShare {
  /** The machine, once a lane reached it; else `null`. */
  current(): RemoteMachine | null;
  /** The machine awake, acquired at the first call, and the ssh target its channels take. */
  reach(): Promise<{ readonly machine: RemoteMachine; readonly ssh: SshTarget }>;
  /** Reached and not put to sleep or lost since: a lane made per pass waits for its connect. */
  awake(): boolean;
  /** A lane's remote run, connect or invalidation: the idle clock starts again. */
  activity(): void;
  /**
   * `work` after every earlier `serial` work on the machine ended (a host's
   * start); refused, unrun, once `signal` aborted or the daemon's exit began.
   */
  serial<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** The daemon's exit began (`release`): no new work may reach the machine. */
  ending(): boolean;
  /**
   * The machine's tree is a Git repository at the worktree's Git state as
   * `refreshGit` last read it. A provider that keeps no `.git` current
   * (`RemoteMachine.syncGit` absent): its capability as it stands.
   */
  gitCurrent(): boolean;
  /**
   * The worktree's Git state read here; when the machine's `.git` is not at
   * it and the machine is awake, brought there as `serial` work. Refused,
   * unrun, once `signal` aborted or the daemon's exit began.
   */
  refreshGit(signal?: AbortSignal): Promise<void>;
  /** A lane lost its channel: the machine may have slept by itself, so the next reach wakes it. */
  lost(): void;
  /** `lane` takes part in the machine's sleep until the returned call. */
  join(lane: SharedLane): () => void;
  /** D12.4: every lane's channel closed, then the machine asked to sleep, once. */
  sleep(): Promise<RemoteSleepOutcome>;
  /** The daemon's exit: the shared connection ended and the machine released (`daemon-exit`). */
  release(): Promise<void>;
}

export interface ShareOptions {
  readonly lane: RemoteLane;
  readonly request: MachineRequest;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
}

/** How long the shared connection stays after its last channel on a machine with no idle sleep. */
const PERSIST_SECONDS = 600;

/** A lane refused the machine's sleep. */
class Busy extends Error {}

/** Work refused because its lane closed or the daemon's exit began. */
export class MachineEnding extends Error {}

export function shareMachine(options: ShareOptions): MachineShare {
  const { lane, request, env } = options;
  const now = options.now ?? Date.now;
  // The settings kept only entries whose provider is built in.
  const provider = providerOf(lane.provider);
  if (provider === null) throw new Error(`no remote provider "${lane.provider}"`);
  const key = { provider: provider.kind, worktreeId: request.worktreeId };
  const lanes = new Set<SharedLane>();
  let machine: RemoteMachine | null = null;
  /** Woken or acquired, and not put to sleep or lost since. */
  let awake = false;
  let reaching: Promise<RemoteMachine> | null = null;
  let last = now();
  let timer: NodeJS.Timeout | null = null;
  let released = false;
  let releasing: Promise<void> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** A sleep in flight, which the daemon's exit waits for. */
  let sleeping: Promise<unknown> = Promise.resolve();
  const refused = () => new MachineEnding("the daemon's exit released the remote machine");

  const track = (write: () => void) => {
    try {
      write();
    } catch (error) {
      request.log(`remote machines file not written: ${String(error)}`);
    }
  };
  const idleMs = (m: RemoteMachine) =>
    idleSleepMinutesOf(lane, m.capabilities.sleepOnIdle) * 60_000;
  const socket = (m: RemoteMachine) => controlSocket(m.ssh, m.id, request.worktreeRoot);
  const target = (m: RemoteMachine): SshTarget => {
    const at = socket(m);
    const idle = idleMs(m);
    return at === null ? m.ssh : multiplexed(m.ssh, at, idle > 0 ? idle / 1000 : PERSIST_SECONDS);
  };

  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = (m: RemoteMachine) => {
    const idle = idleMs(m);
    if (idle <= 0 || timer !== null || released) return;
    timer = setTimeout(() => void idleCheck(m), Math.max(0, idle - (now() - last)));
    timer.unref();
  };
  const idleCheck = async (m: RemoteMachine) => {
    timer = null;
    if (!awake || released || machine !== m) return;
    if (now() - last < idleMs(m)) return arm(m);
    const slept = await sleepAll(m).catch((error: unknown) => {
      request.log(`remote machine ${m.id} did not sleep when idle: ${String(error)}`);
      return null;
    });
    if (slept === "slept") {
      request.log(`remote machine ${m.id}: idle ${idleMs(m) / 60_000} min; asleep`);
    } else {
      // Busy, or its sleep failed: idle again from now.
      last = now();
      arm(m);
    }
  };

  /** Every lane's channel closed, the connection ended, then the machine's own sleep, once. */
  const sleepAll = (m: RemoteMachine): Promise<LaneSleep> => {
    const run = sleepChain(m);
    sleeping = run.catch(() => {});
    return run;
  };
  const sleepChain = async (m: RemoteMachine): Promise<LaneSleep> => {
    const busy = [...lanes].map((l) => l.busy()).find((why) => why !== null);
    if (busy !== undefined) return { busy };
    const asleep = async () => {
      const at = socket(m);
      if (at !== null) await closeMaster(m.ssh, at);
      awake = false;
      disarm();
      await m.sleep();
      if (m.capabilities.sleepOnIdle) track(() => updateMachine(key, { status: "sleeping" }, env));
    };
    const chain = [...lanes].reduceRight<() => Promise<void>>(
      (inner, shared) => async () => {
        const slept = await shared.sleep(inner);
        if (slept !== "slept") throw new Busy(slept.busy);
      },
      asleep,
    );
    try {
      await chain();
      return "slept";
    } catch (error) {
      if (error instanceof Busy) return { busy: error.message };
      throw error;
    }
  };

  const reachOnce = async (): Promise<RemoteMachine> => {
    if (machine === null) {
      const acquired = await provider.acquire(request, lane.providerConfig);
      // Acquired during the exit too: recorded, and `release` waits for this and releases it.
      machine = acquired;
      track(() => recordMachine(recordOf(acquired, request, now()), env));
      if (released) throw refused();
    } else if (!awake) {
      await machine.wake();
      if (released) throw refused();
      track(() => updateMachine(key, { status: "awake", lastUsedAt: now() }, env));
    }
    awake = true;
    last = now();
    arm(machine);
    return machine;
  };

  const serial = <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (released) return Promise.reject(refused());
    const turn = () => {
      if (released) throw refused();
      if (signal?.aborted === true) throw new MachineEnding("its lane closed");
      return work();
    };
    const run = queue.then(turn, turn);
    queue = run.catch(() => {});
    return run;
  };

  /** Every work in flight on the machine ended, then the connection closed and the machine released. */
  const releaseOnce = async (): Promise<void> => {
    released = true;
    disarm();
    // A queued work, refused at its turn, still waits for those before it.
    await queue;
    await reaching?.catch(() => {});
    await sleeping;
    const m = machine;
    if (m === null) return;
    awake = false;
    const at = socket(m);
    if (at !== null) await closeMaster(m.ssh, at);
    try {
      await m.release("daemon-exit");
    } catch (error) {
      request.log(`remote machine ${m.id} not released: ${String(error)}`);
    }
    track(() => updateMachine(key, { status: "detached" }, env));
  };

  return {
    current: () => machine,
    async reach() {
      if (released) throw refused();
      // Lanes that connect at once share one acquire or wake.
      reaching ??= reachOnce().finally(() => {
        reaching = null;
      });
      const reached = await reaching;
      if (released) throw refused();
      return { machine: reached, ssh: target(reached) };
    },
    serial,
    ending: () => released,
    gitCurrent() {
      const m = machine;
      return m?.capabilities.hasGitRepository === true && (m?.gitCurrent?.() ?? true);
    },
    async refreshGit(signal) {
      const m = machine;
      if (m?.syncGit === undefined || released) return;
      // No SSH while the worktree's Git state is the one last found there.
      if (await m.syncGit(null, signal)) return;
      if (!awake || released || signal?.aborted === true) return;
      await serial(async () => {
        if (awake && machine === m) await m.syncGit?.(target(m), signal);
      }, signal);
    },
    awake: () => awake,
    activity() {
      last = now();
    },
    lost() {
      awake = false;
    },
    join(shared) {
      lanes.add(shared);
      return () => lanes.delete(shared);
    },
    async sleep() {
      const m = machine;
      if (m === null)
        return {
          kind: "none",
          reason: `remote ${lane.target ?? lane.provider} reached no machine yet`,
        };
      const named = { provider: m.provider, machine: m.id };
      if (released) return { kind: "busy", ...named, reason: "the daemon's exit is releasing it" };
      if (!m.capabilities.sleepOnIdle) return { kind: "always-on", ...named };
      const slept = await sleepAll(m);
      return slept === "slept"
        ? { kind: "slept", ...named }
        : { kind: "busy", ...named, reason: slept.busy };
    },
    release() {
      releasing ??= releaseOnce();
      return releasing;
    },
  };
}
