import { setTimeout as delay } from "node:timers/promises";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/snapshot.js";
import { changeMarker } from "../store/index.js";
import type { CheckKey, EpochMs, Liveness, Store, TestFileRef } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";

/** Past `runner.timeoutMs`, the Vitest adapter's 1 s and 5 s graces before a run settles. */
export const CLAIM_GRACE_MS = 6_000;

/** The waiter's bound on a claim when `runner.timeoutMs` is `null`. */
export const CLAIM_UNBOUNDED_MS = 600_000;

/** While a file waits on a claim the pump looks again at least this often: a dead claimant writes nothing. */
export const CLAIM_RECHECK_MS = 1_000;

/** How often a wait on a claim reads `changeMarker` for the claimant's record. */
export const CLAIM_POLL_MS = 250;

/**
 * Other worktrees' claims on keys this worktree has queued (spec 001 D5 step
 * 4 and D8 as amended, task 001-205). A claim on key K is another
 * worktree's `test_file_keys` row at K with `pending = 'running'`, whose
 * daemon heartbeats (`TestFileKeyRepo.claimed`): the row its `startTier`
 * wrote. It ends when the claimant's tier records, when its heartbeat is
 * `HEARTBEAT_GRACE_INTERVALS` old, or when this worktree has seen it for its
 * own `runner.timeoutMs` plus `CLAIM_GRACE_MS`; then the file runs here.
 */
export class Claims {
  /** When this worktree first found each key claimed: the waiter's bound runs from it. */
  readonly #seen = new Map<CheckKey, EpochMs>();
  #waiting = false;

  constructor(private readonly context: SchedulerContext) {}

  /** Some queued file waited on a claim since `begin`: the pump looks again (`claimWake`). */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** A scheduling pass starts. */
  begin(): void {
    this.#waiting = false;
  }

  /** Whether a file at `key` waits: another live worktree runs it, and the waiter's bound holds. */
  holds(key: CheckKey): boolean {
    const { store, worktreeId, now } = this.context;
    if (!store.testFileKeys.claimed(worktreeId, key, this.#live())) {
      this.#seen.delete(key);
      return false;
    }
    const at = now();
    const since = this.#seen.get(key) ?? at;
    this.#seen.set(key, since);
    if (at - since > this.#boundMs()) return false;
    this.#waiting = true;
    return true;
  }

  /** `key` runs here: a later claim on it starts a new bound. */
  taken(key: CheckKey): void {
    this.#seen.delete(key);
  }

  /**
   * D5 step 5 as amended: a backlog tier's file count while other live
   * daemons have this worktree's queued keys pending too. The queued files
   * divided by those daemons and this one, rounded up, at least
   * `runner.tierSize` and at most `runner.backlogTierSize`; with none, the
   * latter.
   */
  backlogSize(queued: number): number {
    const { store, worktreeId, policy } = this.context;
    const { tierSize, backlogTierSize } = policy.runner;
    const sharers = store.testFileKeys.sharers(worktreeId, this.#live());
    if (sharers === 0) return backlogTierSize;
    return Math.min(backlogTierSize, Math.max(tierSize, Math.ceil(queued / (sharers + 1))));
  }

  #live(): Liveness {
    return { now: this.context.now(), graceIntervals: HEARTBEAT_GRACE_INTERVALS };
  }

  #boundMs(): number {
    const { timeoutMs } = this.context.policy.runner;
    return timeoutMs === null ? CLAIM_UNBOUNDED_MS : timeoutMs + CLAIM_GRACE_MS;
  }
}

/**
 * Under the lock: whether queued `ref` waits on another worktree's claim of
 * its key. Only a file another worktree's result could stand for waits: not
 * forced, not work an edit caused (`recent`), and missed by a lookup that
 * withheld nothing (`Ledger.probe`). A result the lookup finds is applied
 * and the file leaves the queue; `"settled"`.
 */
export function claimOf(ledger: Ledger, ref: TestFileRef): "waits" | "settled" | "free" {
  const file = ledger.file(ref);
  const key = file?.key ?? null;
  if (!file || key === null || file.blocked !== null) return "free";
  if (ledger.queue.isForced(ref) || ledger.queue.isRecent(ref)) return "free";
  const { hits, mayWait } = ledger.probe(file, key);
  if (hits.length > 0) {
    ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(ref));
    ledger.commit();
    return "settled";
  }
  return mayWait && ledger.claims.holds(key) ? "waits" : "free";
}

/**
 * Settles when the store moves (`changeMarker`, task 001-178), after
 * `CLAIM_RECHECK_MS` at most, or when `signal` aborts: a claimant's record
 * lands as a commit; a claimant that died writes nothing.
 */
export async function claimWake(store: Store, signal: AbortSignal): Promise<void> {
  const before = changeMarker(store);
  const until = performance.now() + CLAIM_RECHECK_MS;
  try {
    while (performance.now() < until) {
      await delay(CLAIM_POLL_MS, undefined, { signal });
      const now = changeMarker(store);
      if (now?.others !== before?.others || now?.own !== before?.own) return;
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}
