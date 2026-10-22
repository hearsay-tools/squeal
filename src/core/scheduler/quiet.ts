import {
  type EpochMs,
  type FileChange,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import { onlyEditorScratch } from "./editor-scratch.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { laneOf } from "./tiers.js";

/**
 * How long a lane waits for quiet after its backlog tier is cancelled (spec
 * 011 C4 step 5 as amended 2026-10-21, the human, row 011-82,
 * `tasks/011-82/design.md` 2.3: 20 s held 67 of 95 and 16 of 63 cancelled
 * tiers on the squeal and cezar stores, where 10 s held 63 and 9 and 30 s
 * 68 and 17). No setting: one number fits both stores.
 */
export const BACKLOG_QUIET_MS = 20_000;

/**
 * The pump looks again at least this often while a lane waits, so a wait
 * ends on the scheduler's clock even when that clock jumps
 * (`SchedulerContext.now`).
 */
export const QUIET_RECHECK_MS = 1_000;

/**
 * Spec 011 C4 step 5 as amended 2026-10-21 (row 011-82): after a revision or
 * an edit's work cancels a lane's backlog tier, the lane waits for quiet. It
 * starts no backlog tier, catch-up included, until `BACKLOG_QUIET_MS` pass
 * with no revision whose re-key queues a test file of the lane. The edit's
 * tiers, a promoted file and the backlog's turn start as before
 * (`selectTier`). `squeal run --all` ends every wait. The waits are the
 * daemon's memory: a daemon that starts has none. Each change is told to
 * `publish`, for status (`publishQuiet`).
 */
export class BacklogQuiet {
  /** When each lane's wait ends, on the scheduler's clock; an end not after now is no wait. */
  readonly #until = new Map<string, EpochMs>();

  constructor(
    private readonly publish: (ends: ReadonlyMap<string, EpochMs>, at: EpochMs) => void = () => {},
  ) {}

  /** A revision or an edit's work cancelled the backlog tier of `lane` at `now`: its wait starts. */
  cancelled(lane: string, now: EpochMs): void {
    this.#until.set(lane, now + BACKLOG_QUIET_MS);
    this.#told(now);
  }

  /** A revision's re-key queued a test file of `lane` at `now`: a wait of the lane starts again. */
  queued(lane: string, now: EpochMs): void {
    if (!this.waits(lane, now)) return;
    this.#until.set(lane, now + BACKLOG_QUIET_MS);
    this.#told(now);
  }

  /** `squeal run --all`: every wait ends. */
  end(now: EpochMs): void {
    if (this.#until.size === 0) return;
    this.#until.clear();
    this.#told(now);
  }

  /** Whether `lane` waits for quiet at `now`. */
  waits(lane: string, now: EpochMs): boolean {
    const until = this.#until.get(lane);
    if (until === undefined) return false;
    if (until > now) return true;
    this.#until.delete(lane);
    return false;
  }

  /** The end of each wait after `now`, by lane. */
  ends(now: EpochMs): ReadonlyMap<string, EpochMs> {
    return new Map([...this.#until].filter(([, until]) => until > now));
  }

  #told(now: EpochMs): void {
    this.publish(this.ends(now), now);
  }
}

/**
 * Calls `BacklogQuiet.queued` once for each lane of `misses` that is
 * queued: what a revision's content re-key or runner part settled
 * (`Ledger.settle`). A miss its runner cannot run is not queued. A revision
 * whose `changes` are all editor scratch files starts no wait again (row
 * 011-117): each vim open would hold the lane 20 s more.
 */
export function quietQueued(
  context: SchedulerContext,
  ledger: Ledger,
  misses: readonly FileState[],
  changes: readonly FileChange[] = [],
): void {
  const { quiet } = context;
  if (quiet === undefined || onlyEditorScratch(changes)) return;
  const now = context.now();
  const lanes = new Set<string>();
  for (const { ref } of misses) if (ledger.queue.has(ref)) lanes.add(laneOf(context, ref));
  for (const lane of lanes) quiet.queued(lane, now);
}

/**
 * How long the pump sleeps before it looks again: until the earliest end of
 * a wait whose lane has a fast file queued, at most `QUIET_RECHECK_MS`;
 * `null` when no such lane waits.
 */
export function quietSleepMs(context: SchedulerContext, ledger: Ledger): number | null {
  const { quiet } = context;
  if (quiet === undefined) return null;
  const now = context.now();
  const ends = quiet.ends(now);
  if (ends.size === 0) return null;
  let earliest: EpochMs | null = null;
  for (const [lane, until] of ends) {
    if (!ledger.queue.hasFast((ref) => laneOf(context, ref) === lane)) continue;
    earliest = earliest === null ? until : Math.min(earliest, until);
  }
  return earliest === null ? null : Math.min(QUIET_RECHECK_MS, Math.max(0, earliest - now));
}

/*
 * Status reads the waits from one `quiet` meta row of the worktree, with
 * the `yields` row's liveness rules: the row carries when it was written,
 * and one older than the live daemon is a predecessor's, whose waits its
 * successor did not inherit. An end is on the daemon's clock, the host's.
 */

/** `meta` key of `worktreeId`'s waits for quiet: `{ at, lanes }`, each lane's end. */
export function quietMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("quiet", worktreeId);
}

/** Writes `worktreeId`'s waits as of `at`; none drops the row. */
export function publishQuiet(
  store: Store,
  worktreeId: WorktreeId,
  ends: ReadonlyMap<string, EpochMs>,
  at: EpochMs,
): void {
  const key = quietMetaKey(worktreeId);
  if (ends.size === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ at, lanes: Object.fromEntries(ends) }));
}

/**
 * The end of each wait the daemon started at `daemonStartedAt` published,
 * by lane, that is after `now`; none without a row, as from a daemon older
 * than row 011-82, or with a predecessor's.
 */
export function publishedQuiet(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlyMap<string, EpochMs> {
  const raw = store.meta.get(quietMetaKey(worktreeId));
  if (raw === null) return new Map();
  try {
    const { at, lanes } = JSON.parse(raw) as { at?: unknown; lanes?: unknown };
    if (typeof at !== "number" || at < daemonStartedAt) return new Map();
    if (typeof lanes !== "object" || lanes === null) return new Map();
    return new Map(
      Object.entries(lanes).filter(
        (entry): entry is [string, EpochMs] => typeof entry[1] === "number" && entry[1] > now,
      ),
    );
  } catch {
    return new Map();
  }
}
