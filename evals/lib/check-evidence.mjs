// Row 005-127 (wave 30): a check that does not run after an edit (spec 019 D1, `at: "manual"`),
// and what a session looked up about Squeal. The scenario a12-manual-check declares the check as
// `manualCheck: { name, files }`; the knob `checks` puts it into the fixture's config.
import { parseClaim } from "./claim.mjs";

/**
 * Whether the session read manual check `check`'s (`{ name, files }`) result after its last
 * edit, or knew it had not run, over replayed timeline `tl` (review exp-minimal-primer-design B1).
 * Met by, before the claim:
 * (a) Squeal's reply or message, after the last edit and at a revision above every one seen
 *     before it, with a daemon validating, that reports the check: a `squeal run <name> --wait`
 *     that completed with at least one of its test files (`completed`), or a current result of
 *     one of its files (`files`, a `run --all --wait`'s status included);
 * (b) an own, completed Vitest run after the last edit whose output names one of its files as run;
 * (c) an `unknown` claim naming the check or a file as not run, after a Squeal text that showed
 *     the check waiting for its run (the start message, a status line, or `squeal checks`).
 * Not by a help text, a request only queued, a run that selected none of its files, a reply
 * from no daemon, or a `fail` claim without (a) or (b). `null` without a claim.
 */
export function manualCheckSeen(tl, check, claimLine) {
  const { claim, evidence } = parseClaim(claimLine);
  if (claim === null || claim === undefined) return null;
  const c = tl.findLastIndex((s) => s.k === "claim");
  const before = c < 0 ? tl : tl.slice(0, c);
  const last = before.findLastIndex((s) => s.k === "edit");
  const floor = Math.max(-1, ...before.slice(0, Math.max(last, 0)).map(revisionOf));
  const after = before.slice(last + 1);
  if (after.some((s) => resultRead(s, check, floor) || ownRunShows(s, check))) return true;
  return (
    claim === "unknown" &&
    before.some((s) => shownWaiting(s, check)) &&
    namesNotRun(evidence ?? "", check)
  );
}

const revisionOf = (s) => (s.k === "squeal" && s.revision !== null ? s.revision : -1);
const mine = (check) => (f) => check.files.includes(f);

/** (a): squeal step `s` reports `check`'s result at a revision above `floor`. */
function resultRead(s, check, floor) {
  if (s.k !== "squeal" || s.daemon === false || revisionOf(s) <= floor) return false;
  const ran = s.sub === "run" && s.completed?.group === check.name && s.completed.testFiles > 0;
  return ran || (s.files ?? []).some(mine(check));
}

/** (b): run step `s` is a completed own Vitest run whose output names one of `check`'s files. */
function ownRunShows(s, check) {
  if (s.k !== "run" || s.runner !== "vitest" || s.informational || !s.completed) return false;
  const failed = (s.failed ?? []).map((f) => f.split(" > ")[0]);
  return [...(s.files ?? []), ...failed].some(mine(check));
}

/** (c): step `s` showed `check` as waiting for its own run. */
const shownWaiting = (s, check) =>
  (s.k === "squeal" && (s.waiting ?? []).includes(check.name)) ||
  (s.k === "checks" && s.manual.includes(check.name));

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
