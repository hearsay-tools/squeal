import type { RemoteSleepOutcome } from "../../types/daemon.js";
import { RemoteRefusal } from "./connect.js";
import { type DiskProbe, judgeDisk } from "./disk-check.js";
import type { LaneSleep } from "./lane.js";
import { forgetMachine, recordMachine, updateMachine } from "./machines-store.js";
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
 *
 * Review 0.1.619-r2 N1: on such a machine a remote run holds a lease
 * (`gitLease`) for its time there, and a refresh that reaches the machine
 * waits until no run holds one, while runs that ask meanwhile wait for the
 * refresh: no test reads a `.git` that moves under it. Runs share the
 * lease, and a machine that keeps no `.git` current gives it at once.
 *
 * Spec 026 D11 (row 026-13): before the first host of each incarnation
 * (an acquire, or a wake after a sleep or a loss) starts, `checkDisk`
 * measures the machine's disk once for every lane. A degraded disk is
 * named in the log and status (`note`); `onSlowDisk: "warn"` goes on,
 * `"refuse"` refuses the machine. A machine acquired by this daemon that
 * sleeps on idle (a managed cloud instance) is replaced once first: it is
 * released as removed, and the next connect acquires a fresh one.
 *
 * Review 0.1.620 B2, S1: the verdict, a refusal too, holds for the whole
 * incarnation, so a second lane or a reconnect measures nothing. A slow
 * machine stays the share's, and tracked, until its removal succeeded:
 * when it fails the machine is refused, not replaced, and the daemon's
 * exit, which waits for a removal in flight, removes it again.
 *
 * Row 026-20 (lessons O1): the daemon's exit aborts the acquire in flight
 * (`MachineRequest.signal`); a provider deletes a machine it created then.
 * Review 0.1.623 B1: the exit says so first (`beginExit`), at once, before
 * it waits for the lanes to close, since a lane's close waits for its
 * connect and so for the acquire. A machine acquired already is unchanged:
 * its work runs to its end, and `release` puts it to sleep.
 *
 * Review 0.1.620 N1: a wake of a machine that keeps `.git` current
 * (`syncGit`) brings `.git` to the worktree's Git state, so it waits for
 * the runs' leases as `refreshGit` does.
 *
 * Row 026-30: once the exit began (`exitSignal`), a Git refresh only
 * reads the worktree's Git state here and no write starts, and one waiting for the runs' leases is refused at once,
 * so a lane that no longer runs anything holds the exit up no more.
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
  /**
   * N1: a remote run's lease on the machine's `.git`, held until the
   * returned call; waits while a refresh reaches the machine.
   */
  gitLease(): Promise<() => void>;
  /**
   * D11: the disk check of `m` with `probe`, once per incarnation of the
   * machine. Rejects with a `RemoteRefusal` for a refused slow disk; a
   * `FreshMachine` when the machine was released to be acquired again.
   */
  checkDisk(m: RemoteMachine, probe: () => Promise<DiskProbe>): Promise<void>;
  /** A lane lost its channel: the machine may have slept by itself, so the next reach wakes it. */
  lost(): void;
  /** `lane` takes part in the machine's sleep until the returned call. */
  join(lane: SharedLane): () => void;
  /** D12.4: every lane's channel closed, then the machine asked to sleep, once. */
  sleep(): Promise<RemoteSleepOutcome>;
  /**
   * Review 0.1.623 B1: the daemon's exit began. Aborts the acquire in flight
   * at once; waits for nothing, and leaves work on a machine acquired
   * already, and its `release`, as they are.
   */
  beginExit(): void;
  /**
   * Row 026-30: aborted once the daemon's exit began (`beginExit`), so a
   * lane's wait for remote permits ends then and no Git refresh starts.
   */
  readonly exitSignal: AbortSignal;
  /** The daemon's exit: the shared connection ended and the machine released (`daemon-exit`). */
  release(): Promise<void>;
}

export interface ShareOptions {
  readonly lane: RemoteLane;
  readonly request: MachineRequest;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  /** D11: the machine's disk status line (`degraded disk: ...`). Absent: the log alone. */
  readonly note?: (text: string) => void;
}

/** How long the shared connection stays after its last channel on a machine with no idle sleep. */
const PERSIST_SECONDS = 600;

/** A lane refused the machine's sleep. */
class Busy extends Error {}

/** Work refused because its lane closed or the daemon's exit began. */
export class MachineEnding extends Error {}

/** D11: a slow disk refused a machine released to be replaced: its lane connects once more. */
export class FreshMachine extends RemoteRefusal {}

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
  /** D11: each acquire or wake starts an incarnation; S1: its disk verdict, a refusal's reason or none. */
  let incarnation = 0;
  let verdict: { readonly at: number; readonly refusal: string | null } | null = null;
  /** B2: a slow machine's removal in flight, which the daemon's exit waits for. */
  let removing: Promise<unknown> | null = null;
  /** B2: the machine whose removal failed: the daemon's exit removes it again. */
  let unremoved: RemoteMachine | null = null;
  /** The incarnation acquired by this daemon, which a slow disk may replace once. */
  let acquiredAt = -1;
  let replaced = false;
  let degraded = false;
  /** N1: remote runs holding the Git lease, and the refresh that waits for none or writes now. */
  let leased = 0;
  let quiet: (() => void)[] = [];
  let gitWriting: Promise<void> | null = null;
  const refused = () => new MachineEnding("the daemon's exit released the remote machine");
  /** Row 026-20 (lessons O1): aborted when the exit begins, so an acquire in flight stops. */
  const exiting = new AbortController();
  const asked: MachineRequest = {
    ...request,
    signal:
      request.signal === undefined
        ? exiting.signal
        : AbortSignal.any([request.signal, exiting.signal]),
  };
  /** The exit began (`beginExit`), or `release` with it. */
  const exited = () => released || exiting.signal.aborted;

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
      const acquired = await provider.acquire(asked, lane.providerConfig);
      // Acquired during the exit too: recorded, and `release` waits for this and releases it.
      machine = acquired;
      acquiredAt = ++incarnation;
      track(() => recordMachine(recordOf(acquired, request, now()), env));
      if (released) throw refused();
    } else if (!awake) {
      const m = machine;
      // N1: the wake moves `.git` too, so it waits for the runs there as `writeGit` does.
      await (m.syncGit === undefined ? m.wake() : asWriter(() => m.wake()));
      incarnation++;
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

  /** N1: resolves once no remote run holds the Git lease, `signal` aborted or the exit began. */
  const leaseFree = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (leased === 0 || exited() || signal?.aborted === true) return resolve();
      quiet.push(resolve);
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });

  /**
   * N1: `write` once no remote run holds the Git lease, while runs that ask
   * for one wait; refused, unrun, once the daemon's exit began meanwhile.
   */
  const asWriter = async <T>(write: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    let open = () => {};
    gitWriting = new Promise((resolve) => {
      open = resolve;
    });
    try {
      await leaseFree(signal);
      if (exited()) throw refused();
      return await write();
    } finally {
      gitWriting = null;
      open();
    }
  };

  /** N1: `m`'s `.git` brought to the worktree's Git state once no run holds the lease. */
  const writeGit = async (m: RemoteMachine, signal?: AbortSignal) => {
    if (!awake || machine !== m || exited()) return;
    await asWriter(async () => {
      if (awake && machine === m && signal?.aborted !== true) await m.syncGit?.(target(m), signal);
    }, signal);
  };

  /** D11: the line of a slow disk in status; a healthy one after it clears the line. */
  const diskNote = (m: RemoteMachine, text: string | null) => {
    if (text === null && !degraded) return;
    degraded = text !== null;
    options.note?.(`remote ${m.id}: ${text ?? "disk within its limit again"}`);
  };
  const checkDisk = async (m: RemoteMachine, probe: () => Promise<DiskProbe>) => {
    const at = incarnation;
    if (verdict?.at === at && machine === m) {
      if (verdict.refusal === null) return;
      throw new RemoteRefusal(verdict.refusal);
    }
    const judged = await judgeDisk(lane.diskCheck, probe);
    if (judged.kind === "unmeasured") {
      // Not a verdict on the disk: the host's start says what is wrong with the machine.
      request.log(`remote machine ${m.id}: disk not measured: ${judged.why}`);
      return;
    }
    if (judged.kind !== "slow") {
      if (judged.kind === "healthy") {
        request.log(`remote machine ${m.id}: disk ${judged.probe.medianMs.toFixed(2)} ms/sync`);
        diskNote(m, null);
      }
      verdict = { at, refusal: null };
      return;
    }
    request.log(`remote machine ${m.id}: ${judged.text}`);
    if (lane.diskCheck.onSlowDisk === "warn") {
      diskNote(m, `${judged.text}; runs go there anyway (onSlowDisk "warn")`);
      verdict = { at, refusal: null };
      return;
    }
    const fresh = acquiredAt === at && m.capabilities.sleepOnIdle && !replaced;
    if (fresh && machine === m && !released && removing === null) await replace(m, judged.text);
    diskNote(m, `${judged.text}; refused (onSlowDisk "refuse")`);
    verdict = { at, refusal: judged.text };
    throw new RemoteRefusal(judged.text);
  };

  /**
   * B2: `m` removed so that the next connect acquires a fresh machine
   * (`FreshMachine`). Kept, tracked and awake again when its removal
   * fails: then it returns, and the caller refuses it.
   */
  const replace = async (m: RemoteMachine, text: string): Promise<void> => {
    diskNote(m, `${text}; acquiring a fresh machine instead`);
    const wasAwake = awake;
    awake = false;
    disarm();
    const removal = (async () => {
      const shared = socket(m);
      if (shared !== null) await closeMaster(m.ssh, shared);
      await m.release("worktree-removed");
    })();
    removing = removal.catch(() => {});
    try {
      await removal;
    } catch (error) {
      request.log(`remote machine ${m.id} not removed, kept and refused: ${String(error)}`);
      unremoved = m;
      if (released || machine !== m) return;
      awake = wasAwake;
      if (awake) arm(m);
      return;
    } finally {
      removing = null;
    }
    machine = null;
    replaced = true;
    verdict = null;
    track(() => forgetMachine(key, env));
    if (released) throw refused();
    throw new FreshMachine(text);
  };

  /** The exit began: the acquire in flight aborts, and a refresh or wake waiting for the leases writes nothing. */
  const beginExit = () => {
    exiting.abort();
    const waiting = quiet;
    quiet = [];
    for (const resolve of waiting) resolve();
  };

  /** Every work in flight on the machine ended, then the connection closed and the machine released. */
  const releaseOnce = async (): Promise<void> => {
    released = true;
    beginExit();
    disarm();
    // A queued work, refused at its turn, still waits for those before it.
    await queue;
    await reaching?.catch(() => {});
    await sleeping;
    await removing;
    const m = machine;
    if (m === null) return;
    awake = false;
    const at = socket(m);
    if (at !== null) await closeMaster(m.ssh, at);
    // B2: a slow machine whose removal failed is removed now, and forgotten once it is.
    const removed = unremoved === m;
    let gone = false;
    try {
      await m.release(removed ? "worktree-removed" : "daemon-exit");
      gone = removed;
    } catch (error) {
      request.log(`remote machine ${m.id} not released: ${String(error)}`);
    }
    track(() => (gone ? forgetMachine(key, env) : updateMachine(key, { status: "detached" }, env)));
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
      if (m?.syncGit === undefined) return;
      // Row 026-30: after the exit began only this read runs, so `gitCurrent` stays true to it.
      // No SSH while the worktree's Git state is the one last found there; the read here always.
      if (await m.syncGit(null, signal)) return;
      if (!awake || exited() || signal?.aborted === true) return;
      await serial(() => writeGit(m, signal), signal);
    },
    async gitLease() {
      // A machine that keeps no `.git` current: no lease, so its runs never wait on one another.
      if (machine?.syncGit === undefined) return () => {};
      while (gitWriting !== null) await gitWriting;
      leased++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        leased--;
        if (leased > 0) return;
        const waiting = quiet;
        quiet = [];
        for (const resolve of waiting) resolve();
      };
    },
    checkDisk,
    awake: () => awake,
    activity() {
      last = now();
    },
    lost() {
      awake = false;
      verdict = null;
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
      if (removing !== null)
        return { kind: "busy", ...named, reason: "its slow disk's removal is in flight" };
      if (!m.capabilities.sleepOnIdle) return { kind: "always-on", ...named };
      const slept = await sleepAll(m);
      return slept === "slept"
        ? { kind: "slept", ...named }
        : { kind: "busy", ...named, reason: slept.busy };
    },
    beginExit,
    exitSignal: exiting.signal,
    release() {
      releasing ??= releaseOnce();
      return releasing;
    },
  };
}
