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
  /** A lane's remote run, connect or invalidation: the idle clock starts again. */
  activity(): void;
  /** `work` after every earlier `serial` work on the machine ended (a host's start). */
  serial<T>(work: () => Promise<T>): Promise<T>;
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
  let queue: Promise<unknown> = Promise.resolve();

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
  const sleepAll = async (m: RemoteMachine): Promise<LaneSleep> => {
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
      machine = acquired;
      track(() => recordMachine(recordOf(acquired, request, now()), env));
    } else if (!awake) {
      await machine.wake();
      track(() => updateMachine(key, { status: "awake", lastUsedAt: now() }, env));
    }
    awake = true;
    last = now();
    arm(machine);
    return machine;
  };

  return {
    current: () => machine,
    async reach() {
      // Lanes that connect at once share one acquire or wake.
      reaching ??= reachOnce().finally(() => {
        reaching = null;
      });
      const reached = await reaching;
      return { machine: reached, ssh: target(reached) };
    },
    serial<T>(work: () => Promise<T>): Promise<T> {
      const run = queue.then(work, work);
      queue = run.catch(() => {});
      return run;
    },
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
      if (!m.capabilities.sleepOnIdle) return { kind: "always-on", ...named };
      const slept = await sleepAll(m);
      return slept === "slept"
        ? { kind: "slept", ...named }
        : { kind: "busy", ...named, reason: slept.busy };
    },
    async release() {
      released = true;
      disarm();
      const m = machine;
      if (m === null) return;
      const at = socket(m);
      if (at !== null) await closeMaster(m.ssh, at);
      try {
        await m.release("daemon-exit");
      } catch (error) {
        request.log(`remote machine ${m.id} not released: ${String(error)}`);
      }
      track(() => updateMachine(key, { status: "detached" }, env));
    },
  };
}
