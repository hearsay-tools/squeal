import { setTimeout as sleep } from "node:timers/promises";
import { createPermitPool, type PermitPool, type PoolLease } from "../../capacity/pool.js";
import { loadUserConfig } from "../../daemon/user-config.js";
import { widthLease } from "../../scheduler/capacity.js";
import { slowSlotDir } from "../../slow/slot.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunOptions, RunReport } from "../../types/runner.js";

/*
 * Spec 021 D18, last bullet (row 021-21): a remote runner host counts
 * against its own machine. Before a background run the daemon's lane asks
 * the host `admit`: one look at a permit pool on the remote machine, the
 * pool its user's daemons share there (their slot directory, their
 * `capacity.hostSlots` and `capacity.backgroundShare`, default 0.75), with
 * its ceiling and its floor. A look never waits: the lane looks again until
 * a grant or a cancel, so the run's own deadline starts only once admitted.
 * The grant is held for the run that follows and returned when it ends.
 */

/** What the lane asks: permits for a tier of `want` workers that runs no fewer than `least`. */
export interface AdmitAsk {
  readonly want: number;
  readonly least: number;
  /**
   * Row 026-23: the attempt the grant is held for, which its run names
   * (`RemoteRunOptions.admitToken`). Concurrent slots hold one grant each;
   * a look drops only its own token's. Absent: the one untokened grant.
   */
  readonly token?: string;
}

/**
 * `admit`'s answer: the workers granted, 0 while the remote machine refuses
 * the run, with the ceiling's refusal line (D18) when the ceiling refused
 * it; `failed`, the remote pool failed and the run goes without a grant, as
 * a local tier does (`TierCapacity.take`).
 */
export interface AdmitAnswer {
  readonly grant: number;
  readonly refusal?: string;
  readonly failed?: string;
}

/** The remote machine's admission, which a remote runner host holds. */
export interface HostAdmission {
  /**
   * One look. A grant is held for the run that names its `token`; one that
   * token held unclaimed is returned first, so a look for 0 workers returns
   * it and takes nothing. An untokened look for 0 returns every held grant.
   */
  admit(ask: AdmitAsk): AdmitAnswer;
  /**
   * The grant held for `token`, for the run that starts now: `UNGRANTED`
   * after a look whose pool failed; `null` when none is held, as when its
   * hold passed or a later look took its place, and then the run must not
   * start (review 0.1.445 R1). Never another token's grant. Absent `token`:
   * the untokened grant, else the oldest held.
   */
  claim(token?: string): PoolLease | typeof UNGRANTED | null;
  /** Returns what it holds; its mark goes. */
  close(): void;
}

/** `claim`'s answer after a look whose pool failed: the run goes without a grant (`AdmitAnswer.failed`). */
export const UNGRANTED = "ungranted";

/** How long a grant waits for its run: the lane sends the run at once, so only a lost daemon leaves one. */
export const ADMITTED_HOLD_MS = 30_000;

/** The admission over the pool `open` makes at the first look; `open` gets the pool's log. */
export function createHostAdmission(
  open: (log: (line: string) => void) => PermitPool,
  holdMs = ADMITTED_HOLD_MS,
): HostAdmission {
  let pool: PermitPool | null = null;
  /** Row 026-23: each attempt's grant, by its token; in insertion order, the oldest first. */
  const held = new Map<HeldKey, HeldEntry>();
  let refusal: string | undefined;
  const take = (key: HeldKey): HeldEntry["lease"] | null => {
    const entry = held.get(key);
    if (entry === undefined) return null;
    clearTimeout(entry.timer);
    held.delete(key);
    return entry.lease;
  };
  const drop = (key: HeldKey) => {
    const lease = take(key);
    if (lease !== null && lease !== UNGRANTED) lease.release();
  };
  const dropAll = () => {
    for (const key of [...held.keys()]) drop(key);
  };
  /** Held for the run of `key` until `holdMs` passes. */
  const hold = (key: HeldKey, lease: PoolLease | typeof UNGRANTED) => {
    const timer = setTimeout(() => {
      if (held.get(key)?.timer === timer) drop(key);
    }, holdMs);
    timer.unref();
    held.set(key, { lease, timer });
  };
  return {
    admit({ want, least, token }) {
      const key = token ?? DEFAULT_KEY;
      if (want < 1 && token === undefined) dropAll();
      else drop(key);
      if (want < 1) return { grant: 0 };
      refusal = undefined;
      let lease: PoolLease | null;
      try {
        pool ??= open((line) => {
          refusal = line;
        });
        lease = pool.acquire(want, "fast", least, "backlog");
      } catch (error) {
        hold(key, UNGRANTED);
        return { grant: want, failed: error instanceof Error ? error.message : String(error) };
      }
      if (lease === null) return refusal === undefined ? { grant: 0 } : { grant: 0, refusal };
      // As a tier's lease under its runner's width: the run's tail never states more than it asked.
      hold(key, widthLease(lease, want));
      return { grant: lease.grant };
    },
    claim(token) {
      if (token !== undefined) return take(token);
      if (held.has(DEFAULT_KEY)) return take(DEFAULT_KEY);
      const oldest = held.keys().next();
      return oldest.done === true ? null : take(oldest.value);
    },
    close() {
      dropAll();
      pool?.close();
      pool = null;
    },
  };
}

/** The key of the grant an untokened look holds. */
const DEFAULT_KEY: unique symbol = Symbol("untokened");
type HeldKey = string | typeof DEFAULT_KEY;
interface HeldEntry {
  readonly lease: PoolLease | typeof UNGRANTED;
  readonly timer: NodeJS.Timeout;
}

/**
 * The pool of the machine this host runs on, as its user's daemons build
 * theirs (spec 001 D11, 021 D18): their slot directory, and
 * `capacity.hostSlots` and `capacity.backgroundShare` of the user's
 * config.json. Its mark is named after `root`, the host's tree: one per
 * worktree that sends runs here.
 */
export function machinePool(
  root: AbsolutePath,
  env: NodeJS.ProcessEnv = process.env,
): (log: (line: string) => void) => PermitPool {
  return (log) => {
    const { hostSlots, backgroundShare } = loadUserConfig({ env }).config.capacity;
    return createPermitPool({
      dir: slowSlotDir(env),
      owner: { pid: process.pid, worktreeId: `runner-host:${root}` },
      hostSlots,
      backgroundShare,
      log,
    });
  };
}

/** What the daemon's side of the wait reads beside the host. */
export interface AdmissionWait {
  /** Aborted by the tier's cancel or a stop: the wait ends at once. */
  readonly cancel?: AbortSignal | undefined;
  /** How often a refused run asks again: the scheduler's `CAPACITY_RECHECK_MS`. */
  readonly everyMs: number;
  /** The daemon's log: each ceiling refusal and a failed pool, as the local pool logs them. */
  readonly log: (line: string) => void;
}

/**
 * The daemon's side: asks the host (`admit`) until the remote machine
 * admits a run of `ask`, and answers the workers granted; `null` once
 * `cancel` aborts, after a grant that came meanwhile went back. Rejects
 * when the host does not answer.
 */
export async function remoteAdmission(
  admit: (ask: AdmitAsk) => Promise<AdmitAnswer>,
  ask: AdmitAsk,
  wait: AdmissionWait,
): Promise<number | null> {
  const cancelled = () => wait.cancel?.aborted === true;
  while (!cancelled()) {
    const answer = await admit(ask);
    if (answer.failed !== undefined) {
      wait.log(
        `its machine's capacity pool failed (${answer.failed}); the run goes without a grant`,
      );
    }
    if (answer.grant > 0) {
      if (!cancelled()) return answer.grant;
      // Row 026-23: only this attempt's grant goes back, never a sibling slot's.
      await admit({ want: 0, least: 0, ...(ask.token === undefined ? {} : { token: ask.token }) });
      return null;
    }
    if (answer.refusal !== undefined) wait.log(`on its machine, ${answer.refusal}`);
    const signal = wait.cancel;
    await sleep(wait.everyMs, undefined, signal === undefined ? {} : { signal }).catch(() => {});
  }
  return null;
}

/** The scheduler's own look again at a refused tier (`CAPACITY_RECHECK_MS`). */
export const ADMIT_EVERY_MS = 2_000;

/**
 * The daemon's side for one background run: its local permits go back
 * (`RunOptions.permits`), then the remote machine admits a tier of
 * `testFiles` as the scheduler sizes one, as wide as its runner runs it and
 * no narrower than at a grant of 1 (`tierWidth`, rows 001-366 and 011-97).
 * The workers granted there; `null` on a cancel meanwhile.
 */
export function admitRun(
  admit: (ask: AdmitAsk) => Promise<AdmitAnswer>,
  testFiles: readonly TestFileRef[],
  run: RunOptions,
  wait: Omit<AdmissionWait, "cancel"> & {
    readonly tierWidth: (testFile: TestFileRef, grant: number) => number;
    /** Row 026-23: the attempt's token, which its run names (`RemoteRunOptions.admitToken`). */
    readonly token?: string;
  },
): Promise<number | null> {
  run.permits?.away();
  const widthAt = (grant: number) =>
    Math.min(
      testFiles.length,
      Math.max(1, ...testFiles.map((file) => wait.tierWidth(file, grant))),
    );
  const ask: AdmitAsk = {
    want: widthAt(testFiles.length),
    least: widthAt(1),
    ...(wait.token === undefined ? {} : { token: wait.token }),
  };
  return remoteAdmission(admit, ask, { ...wait, cancel: cancelOf(run) });
}

/** The tier's cancel or a stop, either of which ends a wait for permits. */
export function cancelOf(run: RunOptions): AbortSignal | undefined {
  const signals = [run.signal, run.stop].filter((signal) => signal !== undefined);
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

/**
 * Row 026-23: `true` when `cancel` aborts before `promise` settles, else
 * `false` once it settles. Absent `cancel`: it waits for `promise`.
 */
export function cancelledFirst(promise: Promise<unknown>, cancel?: AbortSignal): Promise<boolean> {
  const settled = promise.then(
    () => false,
    () => false,
  );
  if (cancel === undefined) return settled;
  if (cancel.aborted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const aborted = () => resolve(true);
    cancel.addEventListener("abort", aborted, { once: true });
    void settled.then((value) => {
      cancel.removeEventListener("abort", aborted);
      resolve(value);
    });
  });
}

/**
 * A run cancelled while it waited for permits, before it started anywhere:
 * it ended with no file completed, as a cancelled run does, so the
 * scheduler queues its files again; under a stop alone its files are not
 * current, as a stopped run's.
 */
export function notStarted(): RunReport {
  return {
    end: "completed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: "cancelled while it waited for permits",
  };
}
