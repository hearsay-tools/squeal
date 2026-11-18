// Row 005-127 (wave 30): a check that does not run after an edit (spec 019 D1, `at: "manual"`),
// and what a session looked up about Squeal. The scenario a12-manual-check declares the check as
// `manualCheck: { name, files }`; the knob `checks` puts it into the fixture's config.
import { parseClaim } from "./claim.mjs";
import { simpleCommands } from "./shell.mjs";
import { SKILL_PATH } from "./transcript.mjs";

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
  const routes = manualCheckRoutes(tl, check, claimLine);
  return routes === null ? null : routes.squeal || routes.ownRun || routes.unknown;
}

/**
 * Which of `manualCheckSeen`'s routes the session took, `{ squeal, ownRun, unknown }` for (a),
 * (b) and (c), or `null` without a claim: the analysis reads them apart (review
 * exp-minimal-primer-design, question 3), since an own run and an honest `unknown` need no look-up.
 */
export function manualCheckRoutes(tl, check, claimLine) {
  const { claim, evidence } = parseClaim(claimLine);
  if (claim === null || claim === undefined) return null;
  const c = tl.findLastIndex((s) => s.k === "claim");
  const before = c < 0 ? tl : tl.slice(0, c);
  const last = before.findLastIndex((s) => s.k === "edit");
  const floor = Math.max(-1, ...before.slice(0, Math.max(last, 0)).map(revisionOf));
  const after = before.slice(last + 1);
  return {
    squeal: after.some((s) => resultRead(s, check, floor)),
    ownRun: after.some((s) => ownRunShows(s, check)),
    unknown:
      claim === "unknown" &&
      before.some((s) => shownWaiting(s, check)) &&
      namesNotRun(evidence ?? "", check),
  };
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

/**
 * Whether claim evidence `text` names check `check` (its name or a file) as not run: one clause
 * (split at `;`, `.`, `,`, `but`, `and`, `while`) holds both the name and a not-run word, so a
 * negation about another suite does not count ("contract passed; I did not run the scripts
 * tests"; review exp-minimal-primer-design B1).
 */
export function namesNotRun(text, check) {
  const names = [check.name, ...check.files].map(
    (w) => new RegExp(`(?:^|[^\\w/.-])${escaped(w)}(?:$|[^\\w/-])`, "i"),
  );
  return String(text)
    .split(/[;.,]\s|\s(?:but|and|while)\s/i)
    .some((clause) => names.some((re) => re.test(clause)) && NOT_RUN.test(clause));
}

/** Words that say a check has not run, or waits to. */
const NOT_RUN = /\bnot\b|\bnever\b|n't\b|\bwithout\b|\bpending\b|\bwait(?:s|ing)?\b|\bskipped\b/i;

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Programs that print a file a shell command names: a skill load when the file is the skill's. */
const READERS = new Set(["cat", "head", "tail", "sed", "less", "more", "bat", "nl", "awk"]);

/**
 * How many times the session's items `items` (a timeline's) loaded Squeal's skill (review
 * exp-minimal-primer-design S2): a Skill call or a Read of its file that did not error and was not
 * refused, or a shell command that exited 0 in which a reader certain to have run (not behind
 * `&&` or `||`, not in a branch) names the skill's file. A search or a listing that names the
 * path, a refused call and a failed one load nothing. The older `skillLoads` stays as it was.
 */
export function skillReadsOf(items) {
  let n = 0;
  for (const k of items) {
    if (k.refused || k.failed) continue;
    if (k.kind === "skill") n++;
    if (k.kind !== "cmd" || k.exit !== 0 || !SKILL_PATH.test(k.cmd)) continue;
    const cmds = simpleCommands(k.cmd, { exit: 0 });
    const reads = (c) =>
      c.established && !c.unreachable && READERS.has(c.words[0]?.replace(/^.*\//, "") ?? "");
    if (cmds.some((c) => reads(c) && c.words.slice(1).some((w) => SKILL_PATH.test(w)))) n++;
  }
  return n;
}

/**
 * Own-run context with no direction (review exp-minimal-primer-design S1): whether the session
 * ran Vitest itself at all (`own-run`, from the grade's count), and whether it did while the
 * latest Squeal evidence since that run's last edit still named checks pending
 * (`own-run-while-pending`, from the retained timeline), which `no-rerun-answered` does not see.
 * A silent pass leaves no evidence, so a run with none since the edit is not counted as pending.
 */
export function runContextOf(grade) {
  const tl = Array.isArray(grade.retained) ? grade.retained : null;
  const runs = typeof grade.vitestRuns === "number" ? grade.vitestRuns > 0 : null;
  return {
    "own-run": runs,
    "own-run-while-pending": tl === null ? null : tl.some((s, i) => pendingRun(tl, s, i)),
  };
}

/** Whether step `s` at `i` is an own Vitest run while the evidence since its last edit was pending. */
function pendingRun(tl, s, i) {
  if (s.k !== "run" || s.runner !== "vitest" || s.informational) return false;
  const e = tl.slice(0, i).findLastIndex((x) => x.k === "edit");
  const j = tl.slice(0, i).findLastIndex((x) => x.k === "squeal");
  return e >= 0 && j > e && (tl[j].pending ?? 0) > 0;
}

/**
 * The look-up context of a cell's grade `grade` (no direction, row 005-127): whether the session
 * ran Squeal's help in any form, `squeal checks`, or loaded Squeal's skill (`skillReadsOf`), and
 * whether it did any of the three (`lookup`). A count the grade does not keep is `null` (a grade before 005-127).
 */
export function lookupsOf(grade) {
  const has = (n) => (typeof n === "number" ? n > 0 : null);
  const parts = {
    "help-used": has(grade.squealHelp),
    "checks-command-used": has(grade.squealChecks),
    "skill-loaded": has(grade.skillReads),
  };
  const values = Object.values(parts);
  const lookup = values.includes(true) ? true : values.includes(null) ? null : false;
  return { lookup, ...parts };
}
