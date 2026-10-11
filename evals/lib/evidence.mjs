// The retained timeline of a cell (spec 006 D4 as amended 2026-10-11, "Retained evidence") and
// the rules that read it: what Squeal evidence the agent had seen, at which revision, before each
// run and before its final claim, and which tests its own runs completed.
//
// A timeline is an array of steps in the order the agent saw them:
//   { k: "edit", path }
//   { k: "run", runner, informational, scope, completed, exit }
//   { k: "squeal", from: "push" | "pull", revision, pending, stale, unknown, slow, daemon,
//     failures, verdict, files, failing }
//   { k: "sleep", s }
//   { k: "claim" }, where the final message was; its word is the cell's `claim`
// It keeps no other free text: paths, counts and words only.

/** Squeal saying no daemon validates (the T4 knob's state). */
export const NO_DAEMON =
  /Not validated: no daemon|Returned without a daemon|^Daemon: no daemon|No daemon (?:is running|has validated)|no daemon is validating|A daemon is starting/m;

const count = (re, text) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : 0;
};

/**
 * The evidence one Squeal text carries, as a `squeal` step, or `null` for a text with none (the
 * primer alone, an explanation). `failures` is the known-failure count before it: a status or a
 * registration lists them all, a delivery only the checks that changed.
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
  const known = listed
    ? Number(listed[1])
    : Math.max(
        0,
        failures +
          (t.match(/^FAIL {2}\S/gm)?.length ?? 0) -
          count(/^PASS {2}(\d+) checks? recovered/m, t) -
          (t.match(/^PASS {2}(?!\d+ checks? recovered)\S/gm)?.length ?? 0) -
          count(/^RESOLVED {2}(\d+) checks?/m, t) -
          (t.match(/^RESOLVED {2}(?!\d+ checks?)\S/gm)?.length ?? 0),
      );
  const step = {
    k: "squeal",
    from,
    revision: rev ? Number(rev[1]) : null,
    pending: counts?.pending ?? null,
    stale: counts?.stale ?? null,
    unknown: counts?.unknown ?? null,
    slow,
    daemon,
    failures: known,
    verdict: "unknown",
    ...filesOf(t, from),
  };
  step.verdict = !daemon ? "unknown" : known > 0 ? "fail" : clear(step) ? "pass" : "unknown";
  return step;
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

const CHECK = /^\s*(?:FAIL|PASS|RESOLVED) {2}(?:\[[^\]]*\] )?(\S+?) > /;

/**
 * `files`, the test files whose checks the text names as current at its revision: every check a
 * delivery says changed, and the known failures a status lists as current; `failing`, those of
 * them named failing.
 */
function filesOf(t, from) {
  const files = new Set();
  const failing = new Set();
  const blocks = t.split(/\n(?=\s*(?:FAIL|PASS|RESOLVED|UNKNOWN) {2})/);
  for (const b of blocks) {
    const m = CHECK.exec(b);
    if (!m) continue;
    if (from === "pull" && !/observed at revision \d+, current\b/.test(b)) continue;
    files.add(m[1]);
    if (/^\s*FAIL/.test(b)) failing.add(m[1]);
  }
  return { files: [...files], failing: [...failing] };
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

/** Normalized test path: relative to the worktree, without `./` or a trailing slash. */
export function relTestPath(p) {
  const s = String(p);
  if (/\/work\//.test(s)) return s.replace(/^.*?\/work\//, "").replace(/\/+$/, "");
  if (s.startsWith("/")) return null;
  return s.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
}

const globRe = (g) =>
  new RegExp(
    `^${g
      .split(/\*\*\/?/)
      .map((part) =>
        part
          .replace(/[.+^${}()|\\]/g, "\\$&")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]"),
      )
      .join(".*")}$`,
  );

/**
 * Whether path `p` of a `runner`'s scope selects test file `f`: the file itself, a directory
 * above it, a glob matching it, or for Vitest a filter its path contains.
 */
export function selects(p, f, runner) {
  const q = relTestPath(p);
  if (q === null) return false;
  if (q === "" || q === "." || q === f || f.startsWith(`${q}/`)) return true;
  if (/[*?[]/.test(q)) return globRe(q).test(f);
  return runner === "vitest" && f.includes(q);
}

/**
 * Whether `scope` (006-16's contract: `{ full: true }` or `{ full: false, paths, names }`) runs
 * every test of one of `files`. A name filter is never the full suite and selects no path of its
 * own (the coordinator, 2026-10-11).
 */
export function covers(scope, files, runner) {
  if (typeof scope !== "object" || scope === null) return false;
  const paths = scope.paths ?? [];
  if (scope.full && !(scope.names?.length > 0)) return true;
  return files.some((f) => paths.some((p) => selects(p, f, runner)));
}

/** The Vitest runs whose scope Squeal had answered current after the last edit before them. */
export function answeredRuns(tl) {
  return tl.filter((r, i) => {
    if (r.k !== "run" || r.runner !== "vitest" || r.informational) return false;
    const e = lastEditBefore(tl, i);
    const paths = r.scope?.full === false ? (r.scope.paths ?? []).map(relTestPath) : [];
    return tl.some(
      (s, j) =>
        s.k === "squeal" &&
        j < i &&
        atEdit(tl, j, e) &&
        (clear(s) || (paths.length > 0 && paths.every((p) => p !== null && s.files.includes(p)))),
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
export function claimedOnEvidence(tl, claim) {
  if (claim === null || claim === undefined) return null;
  if (claim !== "pass") return true;
  const a = atClaim(tl);
  return a.current && tl[a.j].verdict === "pass";
}

/**
 * T2's red step (D4, review 006-13 S1; context, not scored): whether a failure of `test` was seen
 * before the first edit matching `fix`, through Squeal and through a completed own run.
 */
export function redStep(tl, { test, fix }) {
  const re = new RegExp(fix);
  const first = tl.findIndex((s) => s.k === "edit" && re.test(s.path));
  const before = first < 0 ? tl : tl.slice(0, first);
  return {
    squeal: before.some((s) => s.k === "squeal" && s.failing.includes(test)),
    ownRun: before.some(
      (r) =>
        r.k === "run" &&
        r.completed &&
        r.exit !== 0 &&
        r.exit !== null &&
        covers(r.scope, [test], r.runner),
    ),
  };
}
