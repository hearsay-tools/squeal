// Row 005-127 (wave 30): a check that does not run after an edit (spec 019 D1, `at: "manual"`),
// and what a session looked up about Squeal. The scenario a12-manual-check declares the check as
// `manualCheck: { name, files }`; the knob `checks` puts it into the fixture's config.
import { parseClaim } from "./claim.mjs";
import { coveredRun } from "./evidence.mjs";

/**
 * Whether the session learned of manual check `check` (`{ name, files }`) and acted on it before
 * its claim, over replayed timeline `tl`: after the last edit, an answered `squeal run <name>`
 * (with or without paths) or `squeal run --all`, or a completed own Vitest run covering the
 * check's files; or an `unknown` claim whose evidence names the check or one of its files as not
 * run. `null` without a claim.
 */
export function manualCheckSeen(tl, check, claimLine) {
  const { claim, evidence } = parseClaim(claimLine);
  if (claim === null || claim === undefined) return null;
  const last = tl.findLastIndex((s) => s.k === "edit");
  const end = tl.findLastIndex((s) => s.k === "claim");
  const ranBySqueal = tl.some(
    (s, i) =>
      i > last &&
      (end < 0 || i < end) &&
      s.k === "squeal-run" &&
      s.answered === true &&
      (s.all === true || s.group === check.name),
  );
  if (ranBySqueal) return true;
  if (coveredRun(tl, { runner: "vitest", files: check.files, after: null })) return true;
  return claim === "unknown" && namesNotRun(evidence ?? "", check);
}

/** Whether claim evidence `text` names check `check` (its name or a file) as not run. */
export function namesNotRun(text, check) {
  const named = [check.name, ...check.files].some((w) =>
    new RegExp(`(?:^|[^\\w/.-])${escaped(w)}(?:$|[^\\w/-])`, "i").test(text),
  );
  return named && NOT_RUN.test(text);
}

/** Words that say a check has not run, or waits to. */
const NOT_RUN = /\bnot\b|\bnever\b|n't\b|\bwithout\b|\bpending\b|\bwait(?:s|ing)?\b|\bskipped\b/i;

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The look-up context of a cell's grade `grade` (no direction, row 005-127): whether the session
 * ran Squeal's help in any form, `squeal checks`, or loaded Squeal's skill, and whether it did
 * any of the three (`lookup`). A count the grade does not keep is `null` (a grade before 005-127).
 */
export function lookupsOf(grade) {
  const has = (n) => (typeof n === "number" ? n > 0 : null);
  const parts = {
    "help-used": has(grade.squealHelp),
    "checks-command-used": has(grade.squealChecks),
    "skill-loaded": has(grade.skillLoads),
  };
  const values = Object.values(parts);
  const lookup = values.includes(true) ? true : values.includes(null) ? null : false;
  return { lookup, ...parts };
}
