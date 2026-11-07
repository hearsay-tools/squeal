import { timeText } from "../text.js";
import type { RevisionNumber } from "../types/common.js";
import type { DaemonLiveness, FeedLate } from "../types/status.js";
import { WATCHER_TIMINGS } from "../types/watcher.js";

/**
 * Row 011-200 (C6, C8): the change feed is late once the last batch it delivered, a watch batch
 * or a pass, started more than twice the idle interval ago.
 */
export const FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;

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
