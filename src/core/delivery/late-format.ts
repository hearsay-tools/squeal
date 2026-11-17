import { runnersHave } from "../status/feed-late.js";
import { durationText, shellWord, utcTimeText } from "../text.js";
import type { CaughtUp, EditsLate } from "../types/delivery.js";
import { notRunText } from "./header.js";

/*
 * Row 005-97, `tasks/005-93/design.md` section 4 (the human, 2026-11-16): the late and caught-up
 * lines. "The test files your edits affect" everywhere, never "re-keyed"; times in UTC with the
 * zone named; passes stay silent unless they follow a failure (row 005-94). The news header's own
 * count is `ownCountText` (`header.ts`).
 */

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

/** Row 005-97 (a): the line after the header that says why the results are late. */
export function lateLine(late: EditsLate, command: string): string {
  switch (late.kind) {
    case "owed":
      return (
        `${capitalized(notRunText(late.owed, late.files))}, ${durationText(late.ageMs, Math.floor)} ` +
        `after your edit at revision ${late.editRevision}. Passes stay silent unless they follow ` +
        `a failure; Squeal says once when it has caught up. ${nowText(late, command)}`
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
 * Row 005-97 (b): `All 9 test files your edits affect have run at revision 45, with no new
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
