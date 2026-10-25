import { isBusy, withBusySliceSync } from "../store/index.js";
import { timeText } from "../text.js";
import {
  type DaemonLiveness,
  type EpochMs,
  type FeedLate,
  type RevisionNumber,
  type Store,
  WATCHER_TIMINGS,
  type WorktreeId,
  type WorktreeRecord,
  worktreeMetaKey,
} from "../types/index.js";

/**
 * Row 011-200 (C6, C8): the change feed is late once the last batch it delivered, a watch batch
 * or a pass, started more than twice the idle interval ago.
 */
export const FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;

/**
 * The stored time moves only once it is this old: a feed on time keeps it under about 45 s plus a
 * pass, and the daemon writes the row at most four times a minute.
 */
export const FEED_STORED_STEP_MS = 15_000;

/** `meta` key of the start of the last batch `worktreeId`'s feed delivered, as stored. */
export function feedDeliveredMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("feedDelivered", worktreeId);
}

/** When the last batch the worktree's feed delivered started, as stored; `null` when none is. */
export function readFeedDelivered(store: Store, worktreeId: WorktreeId): EpochMs | null {
  const raw = store.meta.get(feedDeliveredMetaKey(worktreeId));
  const at = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * The daemon's side of the row. `record` gets each delivered batch's start, outside the feed's
 * queue, and writes it once the stored time is `FEED_STORED_STEP_MS` old. A busy store skips the
 * write and the next delivery writes; any other failure goes to `onError` once, until a write lands.
 */
export class FeedDeliveredRow {
  #stored: EpochMs | null = null;
  #failed = false;

  constructor(
    private readonly store: Store,
    private readonly worktreeId: WorktreeId,
    private readonly onError: (error: Error) => void,
  ) {}

  record(startedAt: EpochMs): void {
    if (this.#stored !== null && startedAt - this.#stored < FEED_STORED_STEP_MS) return;
    try {
      const key = feedDeliveredMetaKey(this.worktreeId);
      withBusySliceSync(0, () => this.store.meta.set(key, String(startedAt)));
      this.#stored = startedAt;
      this.#failed = false;
    } catch (error) {
      if (isBusy(error) || this.#failed) return;
      this.#failed = true;
      this.onError(new Error(`could not store the change feed's last delivery: ${String(error)}`));
    }
  }
}

/**
 * `live` with `late` when it is an alive daemon whose feed delivered no batch for `FEED_LATE_MS`;
 * otherwise `live`. A time stored before the daemon started is its predecessor's: this daemon
 * has delivered nothing yet, or is a release that stores none, and is not said to be late.
 */
export function withLate(
  store: Store,
  worktree: WorktreeRecord | null,
  live: DaemonLiveness,
  now: EpochMs,
): DaemonLiveness {
  const daemon = worktree?.daemon ?? null;
  if (live.state !== "alive" || live.stopping !== undefined || !worktree || !daemon) return live;
  const since = readFeedDelivered(store, worktree.id);
  if (since === null || since < daemon.startedAt || now - since <= FEED_LATE_MS) return live;
  return { ...live, late: { since } };
}

/** Status's line after the revision line while the feed is late (C6); none otherwise. */
export function lateLines(daemon: DaemonLiveness, revision: RevisionNumber): string[] {
  return daemon.state === "alive" && daemon.late !== undefined
    ? [lateText(daemon.late, revision)]
    : [];
}

/** `Edits since 01:03:50 may not be seen yet; results are current as of revision 23.` */
export function lateText(late: FeedLate, revision: RevisionNumber): string {
  return `Edits since ${timeText(late.since)} may not be seen yet; results are current as of revision ${revision}.`;
}
