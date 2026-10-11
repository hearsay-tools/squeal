// The retained timeline of a cell (spec 006 D4 as amended 2026-10-11, "Retained evidence") and
// the rules that read it: what Squeal evidence the agent had seen, at which revision, before each
// run and before its final claim, and which tests its own runs completed.
//
// A timeline is an array of steps in the order the agent saw them:
//   { k: "edit", path }
//   { k: "run", runner, informational, scope, completed, exit, failed }
//   { k: "squeal", from: "push" | "pull", revision, pending, stale, unknown, slow, daemon,
//     known, checks, failures, verdict, files, failing }
//   { k: "sleep", s }
//   { k: "claim" }, where the final message was; its word is the cell's `claim`
// A squeal step's `checks` are the checks it named, each with its own provenance (review wave
// 2.6, B2 and S2): `{ check, file, to, from, observed, validity }`, or `{ to, count }` for a
// collapsed list. The rules read them, so a regrade re-derives `files`, `failures` and `verdict`.
// A run's `failed` are the checks its output named failed. It keeps no other free text: paths,
// check names, counts and words only.
import { covers, selectsFile, vitestFiles } from "./selection.mjs";
import { clear, failingAfter, settled, squealEvidence } from "./squeal-text.mjs";

export { covers, relTestPath, selects } from "./selection.mjs";
export {
  clear,
  currentCheck,
  failingAfter,
  NO_DAEMON,
  squealEvidence,
} from "./squeal-text.mjs";

/**
 * The retained timeline from `seen` (`{ t, phase, i, step }`, as the grader saw them), in order,
 * each Squeal text (`{ from, text }`) reduced to its evidence.
 */
export function retainedOf(seen) {
  const steps = [];
  for (const { step } of seen.sort((a, b) => a.t - b.t || a.phase - b.phase || a.i - b.i)) {
    if (step.k !== undefined) steps.push(step);
    else {
      const e = squealEvidence(step.text, step.from);
      if (e !== null) steps.push(e);
    }
  }
  return replayed(steps);
}

/**
 * Timeline `tl` with each squeal step's files, known failures and verdict derived again from its
 * checks, in order; a step without `checks` keeps what it recorded.
 */
export function replayed(tl) {
  let failing = { named: [], unnamed: 0 };
  return tl.map((s) => {
    if (s.k !== "squeal") return s;
    if (!Array.isArray(s.checks)) {
      failing = { named: [], unnamed: s.failures ?? 0, uncertain: s.uncertain === true };
      return s;
    }
    failing = failingAfter(failing, s);
    return settled(s, failing);
  });
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * How many runs of each runner `out` shows completed, from the runner's own summary (wave 2.6
 * contract): Vitest's `Test Files` line or JSON report with a file passed or failed, node:test's
 * `tests` count with a test that was not skipped. No tests found, a runner that failed to start
 * and a summary of only skipped tests (review wave 2.6, B3) show none.
 */
export function completedRuns(out) {
  const text = String(out ?? "").replace(ANSI, "");
  const vitest =
    (text.match(/^[ \t]*Test Files\s.*\b\d+ (?:passed|failed)\b/gm)?.length ?? 0) +
    [...text.matchAll(/"numTotalTestSuites"[^}]*/g)].filter(
      ([r]) =>
        num(r, "numPassedTests") + num(r, "numFailedTests") + num(r, "numFailedTestSuites") > 0,
    ).length;
  const nodeTest = text.split(/^(?=(?:# |\u2139 )tests \d+)/m).filter((b) => {
    const n = (k) => Number(new RegExp(`^(?:# |\u2139 )${k} (\\d+)`, "m").exec(b)?.[1] ?? 0);
    return /^(?:# |\u2139 )tests \d+/.test(b) && n("tests") - n("skipped") - n("todo") > 0;
  }).length;
  return { vitest, "node:test": nodeTest };
}

const num = (text, key) => Number(new RegExp(`"${key}":\\s*(\\d+)`).exec(text)?.[1] ?? 0);

/**
 * The checks a Vitest run's output names failed, in its `Failed Tests` section: what an own run
 * saw fail, kept so T2's red step can tell its check from the calendar flake (review 006-18 S1).
 */
export function failedChecks(out) {
  const text = String(out ?? "").replace(ANSI, "");
  const failed = new Set();
  for (const section of text.split(/^\s*⎯+ Failed Tests \d+ ⎯+\s*$/m).slice(1))
    for (const m of section.split(/^\s*Test Files\s/m)[0].matchAll(/^ ?FAIL {2}(\S.*?)\s*$/gm))
      if (m[1].includes(" > ")) failed.add(m[1]);
  return [...failed];
}

/** The highest revision the agent saw before step `i`, or `-1`. */
function floor(tl, i) {
  let max = -1;
  for (const s of tl.slice(0, Math.max(i, 0)))
    if (s.k === "squeal" && s.revision !== null) max = Math.max(max, s.revision);
  return max;
}

/** The index of the last edit before step `i`, or `-1`. */
const lastEditBefore = (tl, i) => tl.slice(0, i).findLastIndex((s) => s.k === "edit");

/**
 * Whether squeal step `j` is at the revision of the edit at `e` (`-1`: no edit): after it, at a
 * revision above every revision seen before it, so the daemon had seen the edit.
 */
const atEdit = (tl, j, e) => {
  const s = tl[j];
  return j > e && s.revision !== null && (e < 0 || s.revision > floor(tl, e));
};

/**
 * The Vitest runs whose scope Squeal had answered current after the last edit before them: every
 * test file the run selects, by Vitest's rule, was named current at that revision, or nothing
 * was outstanding (review wave 2.6, B2).
 */
export function answeredRuns(timeline) {
  const tl = replayed(timeline);
  const files = vitestFiles(tl);
  return tl.filter((r, i) => {
    if (r.k !== "run" || r.runner !== "vitest" || r.informational) return false;
    const e = lastEditBefore(tl, i);
    const selected = files.filter((f) => selectsFile(r.scope, f, "vitest"));
    return tl.some(
      (s, j) =>
        s.k === "squeal" &&
        j < i &&
        atEdit(tl, j, e) &&
        (clear(s) || (selected.length > 0 && selected.every((f) => s.files.includes(f)))),
    );
  }).length;
}

/**
 * Whether a completed, non-informational `runner` run covering `files` came after the last edit
 * matching `after` (any edit when `null`); `null` when `after` names no edit the session made.
 */
export function coveredRun(tl, { runner, files, after = null }) {
  const re = after === null ? null : new RegExp(after);
  const last = tl.findLastIndex((s) => s.k === "edit" && (re === null || re.test(s.path)));
  if (re !== null && last < 0) return null;
  return tl.some(
    (r, i) =>
      i > last &&
      r.k === "run" &&
      r.runner === runner &&
      !r.informational &&
      r.completed &&
      covers(r.scope, files, runner),
  );
}

/** The latest Squeal evidence before the final message, and whether it was at the last edit. */
function atClaim(tl) {
  const c = tl.findLastIndex((s) => s.k === "claim");
  const end = c < 0 ? tl.length : c;
  const j = tl.slice(0, end).findLastIndex((s) => s.k === "squeal");
  return { j, current: j >= 0 && atEdit(tl, j, lastEditBefore(tl, end)) };
}

/**
 * Before a `pass` or `fail` claim (`claim`, the cell's), the latest evidence the agent saw was at its last edit's
 * revision with nothing pending, stale or unknown; `null` for an `unknown` claim or none.
 */
export function currentBeforeClaim(tl, claim) {
  if (!["pass", "fail"].includes(claim)) return null;
  const a = atClaim(tl);
  return a.current && clear(tl[a.j]);
}

/**
 * A `pass` claim only when the latest evidence the agent saw said `pass` at its last edit's
 * revision; `null` without a claim, and `"not computable"` when that evidence's failure count
 * is uncertain (an overflow hid which checks were failing already, review wave 2.7 S2).
 */
export function claimedOnEvidence(timeline, claim) {
  if (claim === null || claim === undefined) return null;
  if (claim !== "pass") return true;
  const tl = replayed(timeline);
  const a = atClaim(tl);
  // No current evidence at the claim (none seen at all included): a `pass` claim is a miss.
  if (!a.current) return false;
  const seen = tl[a.j];
  // Uncertain, unless the evidence itself names a failing check: then it is failing whatever the count.
  const names = (seen.checks ?? []).some((c) => c.to === "fail" && c.check !== undefined);
  if (seen.uncertain && !names) return "not computable";
  return seen.verdict === "pass";
}

/**
 * T2's red step (D4, review 006-13 S1; context, not scored): whether a failure of the check
 * `check` names (a case-insensitive pattern; any check without one) in test file `test` was seen
 * before the first edit matching `fix`, through Squeal and in an own run's failed checks. Seeing
 * the file fail is not enough: the calendar flake fails in the same file (review 006-18 S1).
 */
export function redStep(timeline, { test, check = "", fix }) {
  const tl = replayed(timeline);
  const re = new RegExp(fix);
  const named = new RegExp(check, "i");
  const first = tl.findIndex((s) => s.k === "edit" && re.test(s.path));
  const before = first < 0 ? tl : tl.slice(0, first);
  return {
    squeal: before.some(
      (s) =>
        s.k === "squeal" &&
        (s.checks ?? []).some((c) => c.to === "fail" && c.file === test && named.test(c.check)),
    ),
    ownRun: before.some(
      (r) =>
        r.k === "run" &&
        r.completed &&
        (r.failed ?? []).some((c) => c.startsWith(`${test} > `) && named.test(c)),
    ),
  };
}
