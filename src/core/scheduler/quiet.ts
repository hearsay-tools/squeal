import {
  type EpochMs,
  type FileChange,
  type Store,
  type TestFileRef,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import { onlyEditorScratch } from "./editor-scratch.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { backlogSlot } from "./slots.js";
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
 * How long a lane's catch-up of an edit waits for quiet, cancel or not (spec
 * 011 C4 step 5 as amended 2026-10-23, the human, row 011-153,
 * `research/stored-nothing.md` finding 4: on the 72 h stores 120 s saved 540
 * to 1,360 CPU-s of catch-up per repository; 4 of squeal's 12 catch-up FAILs
 * showed up to 111 s later, 1 of cezar's 6 by 22 s).
 */
export const CATCHUP_QUIET_MS = 120_000;

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
 * (`selectTier`).
 *
 * As amended 2026-10-23 (row 011-153), catch-up of an edit waits too, cancel
 * or not: a lane whose edit made catch-up (`caughtUp`) starts none of its
 * catch-up until `CATCHUP_QUIET_MS` pass with no revision whose re-key
 * queues a test file of the lane. A catch-up revision, as a pull, starts no
 * such wait but starts one again, as any revision does. The edit's tiers, a
 * promoted file and the rest of the backlog are not held.
 *
 * `squeal run --all` ends every wait. The waits are the daemon's memory: a
 * daemon that starts has none. Each change is told to `publish`, for status
 * (`publishQuiet`).
 */
export class BacklogQuiet {
  /** When each lane's wait ends, on the scheduler's clock; an end not after now is no wait. */
  readonly #until = new Map<string, EpochMs>();
  /** When each lane's wait for its catch-up ends, as `#until`. */
  readonly #catchUp = new Map<string, EpochMs>();

  constructor(
    private readonly publish: (
      ends: ReadonlyMap<string, EpochMs>,
      at: EpochMs,
      catchUp: ReadonlyMap<string, EpochMs>,
    ) => void = () => {},
  ) {}

  /** A revision or an edit's work cancelled the backlog tier of `lane` at `now`: its wait starts. */
  cancelled(lane: string, now: EpochMs): void {
    this.#until.set(lane, now + BACKLOG_QUIET_MS);
    this.#told(now);
  }

  /** A revision's re-key queued a test file of `lane` at `now`: each wait of the lane starts again. */
  queued(lane: string, now: EpochMs): void {
    const backlog = this.waits(lane, now);
    const catchUp = this.catchUpWaits(lane, now);
    if (backlog) this.#until.set(lane, now + BACKLOG_QUIET_MS);
    if (catchUp) this.#catchUp.set(lane, now + CATCHUP_QUIET_MS);
    if (backlog || catchUp) this.#told(now);
  }

  /** An edit's revision made catch-up in `lane` at `now`: the lane's wait for it starts. */
  caughtUp(lane: string, now: EpochMs): void {
    this.#catchUp.set(lane, now + CATCHUP_QUIET_MS);
    this.#told(now);
  }

  /** `squeal run --all`: every wait ends. */
  end(now: EpochMs): void {
    if (this.#until.size === 0 && this.#catchUp.size === 0) return;
    this.#until.clear();
    this.#catchUp.clear();
    this.#told(now);
  }

  /** Whether `lane` waits for quiet at `now`. */
  waits(lane: string, now: EpochMs): boolean {
    return waiting(this.#until, lane, now);
  }

  /** Whether `lane`'s catch-up waits for quiet at `now`. */
  catchUpWaits(lane: string, now: EpochMs): boolean {
    return waiting(this.#catchUp, lane, now);
  }

  /** The end of each wait after `now`, by lane. */
  ends(now: EpochMs): ReadonlyMap<string, EpochMs> {
    return after(this.#until, now);
  }

  /** The end of each catch-up's wait after `now`, by lane. */
  catchUpEnds(now: EpochMs): ReadonlyMap<string, EpochMs> {
    return after(this.#catchUp, now);
  }

  #told(now: EpochMs): void {
    this.publish(this.ends(now), now, this.catchUpEnds(now));
  }
}

/** Whether `lane`'s wait in `until` ends after `now`; a wait that ended leaves `until`. */
function waiting(until: Map<string, EpochMs>, lane: string, now: EpochMs): boolean {
  const end = until.get(lane);
  if (end !== undefined && end <= now) until.delete(lane);
  return end !== undefined && end > now;
}

function after(until: ReadonlyMap<string, EpochMs>, now: EpochMs): ReadonlyMap<string, EpochMs> {
  return new Map([...until].filter(([, end]) => end > now));
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
 * Calls `BacklogQuiet.caughtUp` once for each lane of the files `ids` that
 * is queued as catch-up: an edit's reach after its cut (`demote`). A lane
 * that runs its backlog in slots never waits (row 011-153).
 */
export function quietCaughtUp(
  context: SchedulerContext,
  ledger: Ledger,
  ids: Iterable<string>,
): void {
  const { quiet } = context;
  if (quiet === undefined) return;
  const now = context.now();
  const lanes = new Set<string>();
  for (const id of ids) {
    const ref = ledger.files.get(id)?.ref;
    if (ref === undefined || !ledger.queue.isCatchUp(ref) || backlogSlot(context, ref) !== null)
      continue;
    lanes.add(laneOf(context, ref));
  }
  for (const lane of lanes) quiet.caughtUp(lane, now);
}

/**
 * Whether `selectTier` leaves `ref`, queued in `lane`, queued at `now` in a
 * backlog tier or the second group's turn (`tier`): in a backlog tier while
 * the lane waits for quiet after a cancel; in either while it is catch-up
 * and the lane's catch-up waits (row 011-153). An edit's tier takes it.
 */
export function quietHolds(
  context: SchedulerContext,
  ledger: Ledger,
  ref: TestFileRef,
  lane: string,
  tier: { readonly backlog: boolean; readonly turn: boolean },
  now: EpochMs,
): boolean {
  const { quiet } = context;
  if (quiet === undefined || !(tier.backlog || tier.turn)) return false;
  if (tier.backlog && quiet.waits(lane, now)) return true;
  return ledger.queue.isCatchUp(ref) && quiet.catchUpWaits(lane, now);
}

/**
 * How long the pump sleeps before it looks again: until the earliest end of
 * a wait whose lane has a fast file queued, or of a catch-up's wait whose
 * lane has a catch-up file queued, at most `QUIET_RECHECK_MS`; `null` when
 * no such lane waits.
 */
export function quietSleepMs(context: SchedulerContext, ledger: Ledger): number | null {
  const { quiet } = context;
  if (quiet === undefined) return null;
  const now = context.now();
  const { queue } = ledger;
  const holding = (ends: ReadonlyMap<string, EpochMs>, held: (ref: TestFileRef) => boolean) =>
    [...ends]
      .filter(([lane]) => queue.hasFast((ref) => laneOf(context, ref) === lane && held(ref)))
      .map(([, until]) => until);
  const until = [
    ...holding(quiet.ends(now), () => true),
    ...holding(quiet.catchUpEnds(now), (ref) => queue.isCatchUp(ref)),
  ];
  if (until.length === 0) return null;
  return Math.min(QUIET_RECHECK_MS, Math.max(0, Math.min(...until) - now));
}

/*
 * Status reads the waits from one `quiet` meta row of the worktree, with
 * the `yields` row's liveness rules: the row carries when it was written,
 * and one older than the live daemon is a predecessor's, whose waits its
 * successor did not inherit. An end is on the daemon's clock, the host's.
 */

/**
 * `meta` key of `worktreeId`'s waits for quiet: `{ at, lanes, catchUp }`,
 * each lane's end; `catchUp` since row 011-153, absent with no such wait.
 */
export function quietMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("quiet", worktreeId);
}

const NO_ENDS: ReadonlyMap<string, EpochMs> = new Map();

/** Writes `worktreeId`'s waits as of `at`; none drops the row. */
export function publishQuiet(
  store: Store,
  worktreeId: WorktreeId,
  ends: ReadonlyMap<string, EpochMs>,
  at: EpochMs,
  catchUp: ReadonlyMap<string, EpochMs> = NO_ENDS,
): void {
  const key = quietMetaKey(worktreeId);
  if (ends.size === 0 && catchUp.size === 0) store.meta.delete(key);
  else {
    const row = {
      at,
      lanes: Object.fromEntries(ends),
      ...(catchUp.size === 0 ? {} : { catchUp: Object.fromEntries(catchUp) }),
    };
    store.meta.set(key, JSON.stringify(row));
  }
}

/** Both kinds of wait as published: after a cancel, and catch-up's (row 011-153). */
export interface PublishedQuiet {
  readonly backlog: ReadonlyMap<string, EpochMs>;
  readonly catchUp: ReadonlyMap<string, EpochMs>;
}

/**
 * The end of each wait after a cancel the daemon started at
 * `daemonStartedAt` published, by lane, that is after `now`; none without a
 * row, as from a daemon older than row 011-82, or with a predecessor's.
 */
export function publishedQuiet(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): ReadonlyMap<string, EpochMs> {
  return publishedWaits(store, worktreeId, daemonStartedAt, now).backlog;
}

/** `publishedQuiet`, catch-up's waits beside; none of them from a daemon older than row 011-153. */
export function publishedWaits(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
  now: EpochMs,
): PublishedQuiet {
  const none = { backlog: NO_ENDS, catchUp: NO_ENDS };
  const raw = store.meta.get(quietMetaKey(worktreeId));
  if (raw === null) return none;
  try {
    const { at, lanes, catchUp } = JSON.parse(raw) as {
      at?: unknown;
      lanes?: unknown;
      catchUp?: unknown;
    };
    if (typeof at !== "number" || at < daemonStartedAt) return none;
    return { backlog: endsAfter(lanes, now), catchUp: endsAfter(catchUp, now) };
  } catch {
    return none;
  }
}

function endsAfter(lanes: unknown, now: EpochMs): ReadonlyMap<string, EpochMs> {
  if (typeof lanes !== "object" || lanes === null) return NO_ENDS;
  return new Map(
    Object.entries(lanes).filter(
      (entry): entry is [string, EpochMs] => typeof entry[1] === "number" && entry[1] > now,
    ),
  );
}
