import { timeText } from "../text.js";
import type { RevisionNumber } from "../types/common.js";
import type { DaemonLiveness, FeedLate, StatusHeader } from "../types/status.js";
import { WATCHER_TIMINGS } from "../types/watcher.js";

/**
 * Row 011-200 (C6, C8): the change feed is late once the last batch it delivered, a watch batch
 * or a pass, started more than twice the idle interval ago.
 */
export const FEED_LATE_MS = 2 * WATCHER_TIMINGS.reconcileIntervalMs;

/*
 * Row 011-311 (the human, 2026-11-10): the words for the two delays the counts can leave out.
 * Squeal has not read the newest edits (a late change feed, row 011-200), or the runner has not
 * listed the current revision's test files (its runner part, spec 001 D2 as amended). With both,
 * one sentence says both, so they never read as two claims about one delay. No sentence calls
 * the revision the counts cover "current": that word means a check passed and is up to date.
 */

/** What the delay sentences read of a header. */
export type DelayFields = Pick<StatusHeader, "revision" | "runnerPartPending" | "listingRunners">;

/**
 * `Vitest has`, `Vitest and pytest have`: the runners that list a revision's test files
 * (`StatusHeader.listingRunners`) as a subject; `the test runner has` when none is known.
 */
export function runnersHave(runners: readonly string[] | undefined, start: boolean): string {
  if (runners === undefined || runners.length === 0) {
    return `${start ? "The" : "the"} test runner has`;
  }
  const last = runners.at(-1);
  if (runners.length === 1) return `${last} has`;
  return `${runners.slice(0, -1).join(", ")} and ${last} have`;
}

/** What a revision's test files not listed yet leave out; `files` names them, as Stop's groups do. */
export interface Unlisted {
  readonly revision: RevisionNumber;
  readonly runners?: readonly string[] | undefined;
  /** `test files` by default; Stop's `slow test files`, `e2e test files`. */
  readonly files?: string;
}

function unlisted({ revision, runners, files = "test files" }: Unlisted, start: boolean): string {
  return `${runnersHave(runners, start)} not yet listed the test files of revision ${revision}, so new ${files} are not counted`;
}

/** `Vitest has not yet listed the test files of revision 5, so new test files are not counted.` */
export function unlistedText(what: Unlisted): string {
  return `${unlisted(what, true)}.`;
}

/** The same words as a clause inside a sentence, with no period. */
export function unlistedClause(what: Unlisted): string {
  return unlisted(what, false);
}

/** `Squeal has not yet read edits made after 01:03:50; these counts cover revision 23 and earlier.` */
export function lateText(late: FeedLate, revision: RevisionNumber): string {
  return `Squeal has not yet read edits made after ${timeText(late.since)}; these counts cover revision ${revision} and earlier.`;
}

/** Both delays: `Squeal is behind: it has not read edits made after 00:29:56, and Vitest has …`. */
function behindText(late: FeedLate, revision: RevisionNumber, runners?: readonly string[]): string {
  return (
    `Squeal is behind: it has not read edits made after ${timeText(late.since)}, and ` +
    `${runnersHave(runners, false)} not listed revision ${revision}'s test files yet, so new test files are not counted.`
  );
}

/**
 * The one sentence for what the counts leave out: edits not read while the feed is `late`, the
 * revision's test files not listed while its runner part is pending, or both; `null` for neither.
 */
export function delaysText(header: DelayFields, late: FeedLate | undefined): string | null {
  const { revision } = header;
  const pending = header.runnerPartPending === true;
  if (late === undefined) {
    return pending ? unlistedText({ revision, runners: header.listingRunners }) : null;
  }
  return pending ? behindText(late, revision, header.listingRunners) : lateText(late, revision);
}

/** The feed's lag while the daemon is alive (C6); none otherwise. */
export function lateOf(daemon: DaemonLiveness | undefined): FeedLate | undefined {
  return daemon?.state === "alive" ? daemon.late : undefined;
}

/** Status's line after the revision line while the feed is late or the revision unlisted (C6). */
export function delaysLines(header: DelayFields & Pick<StatusHeader, "daemon">): string[] {
  const text = delaysText(header, lateOf(header.daemon));
  return text === null ? [] : [text];
}
