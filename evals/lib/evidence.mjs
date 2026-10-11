// The retained timeline of a cell (spec 006 D4 as amended 2026-10-11, "Retained evidence") and
// the rules that read it: what Squeal evidence the agent had seen, at which revision, before each
// run and before its final claim, and which tests its own runs completed.
//
// A timeline is an array of steps in the order the agent saw them:
//   { k: "edit", path }
//   { k: "run", runner, informational, scope, completed, exit, failed }
//   { k: "squeal", from: "push" | "pull", revision, pending, stale, unknown, slow, daemon,
//     known, checks, failures, verdict, files, failing }
// A squeal step's `checks` are the checks it named, each with its own provenance (review wave
// 2.6, B2 and S2): `{ check, file, to, from, observed, validity }`, or `{ to, count }` for a
// collapsed list. The rules read them, so a regrade re-derives `files`, `failures` and `verdict`.
//   { k: "sleep", s }
//   { k: "claim" }, where the final message was; its word is the cell's `claim`
// It keeps no other free text: paths, check names, counts and words only.
import { covers, selectsFile, vitestFiles } from "./selection.mjs";

export { covers, relTestPath, selects } from "./selection.mjs";

/** Squeal saying no daemon validates (the T4 knob's state). */
export const NO_DAEMON =
  /Not validated: no daemon|Returned without a daemon|^Daemon: no daemon|No daemon (?:is running|has validated)|no daemon is validating|A daemon is starting/m;

const count = (re, text) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : 0;
};

/**
 * The evidence one Squeal text carries, as a `squeal` step, or `null` for a text with none (the
 * primer alone, an explanation). `failures` is what was known failing before it, a count or a
 * `failingAfter` state: a status or a registration lists every known failure, a delivery only
 * the checks that changed.
 */
export function squealEvidence(text, from, failures = 0) {
  const t = String(text ?? "");
  const rev = /\bRevision:? (\d+)/.exec(t) ?? /\bat revision (\d+)/.exec(t);
  const daemon = !NO_DAEMON.test(t);
  const counts = countsOf(t);
  if (!rev && counts === null && daemon) return null;
  const tier = /^Slow tier: (.*)$/m.exec(t)?.[1];
  const slow =
    tier === undefined
      ? null
      : !/no slow test files listed|sources changed since|pending|queued|running|not run/.test(
          tier,
        );
  const listed = /^Known failures: (\d+)/m.exec(t);
  const step = {
    k: "squeal",
    from,
    revision: rev ? Number(rev[1]) : null,
    pending: counts?.pending ?? null,
    stale: counts?.stale ?? null,
    unknown: counts?.unknown ?? null,
    slow,
    daemon,
    known: listed ? Number(listed[1]) : null,
    checks: checksOf(t),
  };
  const before = typeof failures === "number" ? { named: [], unnamed: failures } : failures;
  return settled(step, failingAfter(before, step));
}

/** `step` with what it says: its current files, its known failures and its verdict. */
function settled(step, after) {
  const current = step.checks.filter((c) => currentCheck(step, c));
  const failures = after.named.length + after.unnamed;
  const verdict = !step.daemon
    ? "unknown"
    : failures > 0
      ? "fail"
      : clear(step)
        ? "pass"
        : "unknown";
  return {
    ...step,
    failures,
    verdict,
    files: [...new Set(current.map((c) => c.file))],
    failing: [...new Set(current.filter((c) => c.to === "fail").map((c) => c.file))],
  };
}

/**
 * The known failures after squeal step `s`, from those before it (`{ named, unnamed }`, check
 * names and a count of failures not named). A status or registration lists them all; in a
 * delivery a failing check is added once however often its failure changed, and a recovery or a
 * retirement removes that same check once (review wave 2.6, S2).
 */
export function failingAfter(before, s) {
  if (s.known !== null && s.known !== undefined) {
    const named = [...new Set(s.checks.filter((c) => c.to === "fail").map((c) => c.check))];
    return { named, unnamed: Math.max(0, s.known - named.length) };
  }
  const named = [...before.named];
  let unnamed = before.unnamed;
  const remove = (check) => {
    const i = check === null ? -1 : named.indexOf(check);
    if (i >= 0) named.splice(i, 1);
    else if (unnamed > 0) unnamed--;
    else if (check === null) named.shift();
  };
  for (const c of s.checks) {
    if (c.to === "fail") {
      if (!named.includes(c.check)) named.push(c.check);
    } else for (let n = 0; n < (c.count ?? 1); n++) remove(c.check ?? null);
  }
  return { named, unnamed };
}

/**
 * Whether check `c` of squeal step `s` is current at the step's revision: its own line says no
 * older revision, no pending revision and no stale result (review wave 2.6, B2). A status lists
 * a known failure as current in words; a delivered check is current when its run was at the
 * delivery's revision.
 */
export function currentCheck(s, c) {
  if (c.check === undefined || c.validity !== "current") return false;
  if (s.from === "pull") return c.stated === true;
  return c.observed === null || c.observed === s.revision;
}

/** Pending, stale and unknown counts in a delivered header or a status, or `null` for none. */
function countsOf(t) {
  let pending;
  let stale;
  let unknown;
  const header = /(\d+) current, (\d+) pending, (\d+) stale, (\d+) unknown/.exec(t);
  const affected = /^Affected checks: (.*)$/m.exec(t)?.[1];
  if (header) [pending, stale, unknown] = [header[2], header[3], header[4]].map(Number);
  else if (affected !== undefined && !/^none counted/.test(affected)) {
    pending = count(/(\d+) running/, affected) + count(/(\d+) queued/, affected);
    stale = count(/(\d+) stale/, affected);
    unknown = count(/(\d+) unknown/, affected);
  } else return null;
  const files = /Test files without checks: (\d+) pending, (\d+) unknown/.exec(t);
  if (files) {
    pending += Number(files[1]);
    unknown += Number(files[2]);
  }
  // Counts that leave out test files not listed yet, or a runner part still to come.
  if (/has not listed this worktree's test files|test files it adds/.test(t)) pending++;
  if (/No dependencies are installed|until an install/.test(t)) unknown++;
  return { pending, stale, unknown };
}

/** A check as `formatCheck` names it, `[project] path > test` or `path (file-level)`: its file. */
const FILE = /^(?:\[[^\]]*\] )?(\S+?)(?: > | \(|$)/;
/** A collapsed list of recoveries or retirements: `PASS  6 checks recovered (FAIL -> PASS)`. */
const COLLAPSED = /^(\d+) checks? (?:recovered|no longer reported)/;

/**
 * Each check the text names, with its own provenance (`squeal status`, a registration or a
 * delivery, as `formatDelta` and `formatStatus` word them): `{ check, file, to, from, observed,
 * validity }`, `to` `fail`, `pass` or `resolved`, `from` the outcome it changed from (`null`
 * when first observed), `observed` the revision its result is from (`null` when unstated) and
 * `validity` `current`, `pending`, `stale` or `unknown`; `stated` when a status says `current`.
 */
function checksOf(t) {
  const checks = [];
  for (const b of t.split(/\n(?=\s*(?:FAIL|PASS|RESOLVED|UNKNOWN) {2})/)) {
    const head = /^\s*(FAIL|PASS|RESOLVED) {2}(.+)$/m.exec(b);
    if (!head) continue;
    const to = head[1].toLowerCase();
    const name = head[2].trim();
    const collapsed = COLLAPSED.exec(name);
    if (collapsed && to !== "fail") {
      checks.push({ to, count: Number(collapsed[1]) });
      continue;
    }
    const body = b.slice(head.index + head[0].length);
    const change = /^\s*(?:first observed: FAIL|(\w+) -> (?:FAIL|PASS|no longer))/m.exec(body);
    const observed = /\bat revision (\d+)/.exec(body);
    const stated = /observed at revision \d+, (\w+)/.exec(body)?.[1];
    const validity =
      stated ??
      (/\brevision \d+ pending\b|^\s*pending, observed/m.test(body)
        ? "pending"
        : /^\s*stale\b|, stale\b/m.test(body)
          ? "stale"
          : /^\s*unknown, observed/m.test(body)
            ? "unknown"
            : "current");
    checks.push({
      check: name,
      file: FILE.exec(name)?.[1] ?? name,
      to,
      from: change ? (change[1]?.toLowerCase() ?? null) : null,
      observed: observed ? Number(observed[1]) : null,
      validity,
      ...(stated === undefined ? {} : { stated: true }),
    });
  }
  return checks;
}

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
      failing = { named: [], unnamed: s.failures ?? 0 };
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

/** Nothing pending, stale or unknown, the slow tier included, with a daemon validating. */
export const clear = (s) =>
  s.daemon !== false && s.pending === 0 && s.stale === 0 && s.unknown === 0 && s.slow !== false;

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
 * revision; `null` without a claim.
 */
export function claimedOnEvidence(timeline, claim) {
  if (claim === null || claim === undefined) return null;
  if (claim !== "pass") return true;
  const tl = replayed(timeline);
  const a = atClaim(tl);
  return a.current && tl[a.j].verdict === "pass";
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
