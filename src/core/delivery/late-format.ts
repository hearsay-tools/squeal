import { runnersHave } from "../status/feed-late.js";
import { durationText, plural, shellWord } from "../text.js";
import type { CaughtUp, EditsLate, OwnEdits } from "../types/delivery.js";

/*
 * Row 005-93, design section 4 (the human, 2026-11-16): the words for the results of the
 * consumer's own edits. "The test files your edits affect" everywhere, never "re-keyed"; times
 * in UTC with the zone named.
 */

/** `14:03:20 UTC`. */
export function utcTimeText(at: number): string {
  return `${new Date(at).toISOString().slice(11, 19)} UTC`;
}

/** `the 9 test files your edits affect`, `the 1 test file your edits affect`. */
function affected(files: number): string {
  return `the ${plural(files, "test file")} your edits affect`;
}

/** `3 of the 9 test files your edits affect have not run`; `the 1 test file … has not run`. */
function notRun(owed: number, files: number): string {
  const verb = owed === 1 ? "has" : "have";
  return owed === files
    ? `${affected(files)} ${verb} not run`
    : `${owed} of ${affected(files)} ${verb} not run`;
}

/**
 * Row 005-93 (c): the news header's own count, after the revision and its changed paths:
 * `3 of the 9 test files your edits affect have not run.`, or once none is owed,
 * `the 9 test files your edits affect have all run.`; with files that ran with no result,
 * `…; 1 with no result (unknown).`
 */
export function ownCountText({ files, owed, unknown = 0 }: OwnEdits): string {
  const count =
    owed > 0
      ? notRun(owed, files)
      : files === 1
        ? `${affected(files)} has run`
        : `${affected(files)} have all run`;
  // Review 0.1.530 B4: a file that ran with no result is said, so "run" never reads as passed.
  return unknown === 0 ? `${count}.` : `${count}; ${unknown} with no result (unknown).`;
}

/** The late line's last sentence: the wait that runs the owed files first, or a hand run. */
function nowText(late: Extract<EditsLate, { kind: "owed" }>, command: string): string {
  if (late.named !== undefined) {
    const paths = late.named.map(shellWord).join(" ");
    const them = late.named.length === 1 ? "it" : "them";
    return `To have ${them} now, \`${command} status --wait 60000 ${paths}\` runs ${them} first; or run ${them} yourself.`;
  }
  return (
    `To have them now, \`${command} status --wait 60000 <path>...\` runs the files your paths ` +
    "select first; or run those files yourself."
  );
}

/** Row 005-93 (a): the line after the header that says why the results are late. */
export function lateLine(late: EditsLate, command: string): string {
  switch (late.kind) {
    case "owed":
      return (
        `${capitalized(notRun(late.owed, late.files))}, ${durationText(late.ageMs, Math.floor)} ` +
        `after your edit at revision ${late.editRevision}. Passing results stay silent; ` +
        `Squeal says once when it has caught up. ${nowText(late, command)}`
      );
    case "unread":
      return (
        `Squeal has not read edits made after ${utcTimeText(late.since)}, so it has not queued ` +
        `their test files. To have results now, run the tests yourself; \`${command} status\` ` +
        "says when Squeal reads them again."
      );
    case "unlisted":
      return (
        `${runnersHave(late.runners, true)} not yet listed the test files of revision ` +
        `${late.revision}, so Squeal has not queued them. To have results now, run the tests ` +
        `yourself; \`${command} status\` says when they are listed.`
      );
  }
}

/**
 * Row 005-93 (b): `All 9 test files your edits affect have run at revision 45, with no new
 * failure.` With checks that gave no result, how many.
 */
export function caughtUpLine({ revision, files, unknown }: CaughtUp): string {
  const which =
    files === 1
      ? `The 1 test file your edits affect has run at revision ${revision}`
      : `All ${files} test files your edits affect have run at revision ${revision}`;
  if (unknown === 0) return `${which}, with no new failure.`;
  return `${which}: ${files - unknown} with results, ${unknown} with no result (unknown); no new failure.`;
}

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
