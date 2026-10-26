import {
  COVERAGE_MEASURES,
  type CoverageMeasure,
  type CoverageSummary,
  functionKey,
  readEvidence,
  readSummary,
} from "../core/code/crap/index.js";
import type { CodeStore } from "../core/code/store/types.js";
import { lastTransition } from "../core/delivery/code-deliver.js";
import { type CodeBound, isOwn } from "../core/delivery/code-delta.js";
import { functionName, toldOverWords } from "../core/delivery/code-format.js";
import { noCoverageWords, runnerName } from "../core/delivery/code-runners.js";
import { createInputMatcher } from "../core/keys/glob.js";
import { plural } from "../core/text.js";
import type { CodeKnownState, CodeMeasure, CodeOutcome } from "../core/types/code.js";
import type { RelativePath, RevisionNumber, WorktreeId } from "../core/types/index.js";

/*
 * Spec 015 D9 (row 015-12): `squeal code`'s coverage part, while the
 * daemon's coverage step judges here. With paths, each function's CRAP,
 * whether a test runs it in its own process, and its evidence; without,
 * the functions over CRAP and the number untested, with `--changed` those
 * whose state changed, and with `--told` those failing that the session
 * was told of in full (row 015-40). Row 015-64: only the checks judged,
 * and a file `coverage.exclude` leaves out says so.
 */

/** Row 015-64 (D9 as amended 2026-10-26): what a function `uncovered` reads as. */
const UNTESTED = "untested: no test runs it in its own process";
const TESTED = "a test runs it in its own process";

/**
 * One function's coverage states and evidence. Row 015-64: `crap` and
 * `uncovered` are absent while their check is off; `excluded` is set, and
 * both absent, for a file `coverage.exclude` leaves out.
 */
export interface CodeReportCoverageOf {
  readonly crap?: { readonly outcome: CodeOutcome; readonly value: number | null };
  readonly uncovered?: CodeOutcome;
  readonly excluded?: true;
  /**
   * Row 015-75: the file is unknown since runners whose runs give no record
   * load it, by their names, and no current record proved this function's
   * states (review 0.1.354 B1); then nothing else is set.
   */
  readonly notMeasured?: readonly string[];
  /** At the file's last judgement; absent while it has none. */
  readonly lines?: number;
  readonly covered?: number;
  readonly testFiles?: number;
  readonly first?: readonly RelativePath[];
}

/** One function the coverage part lists without paths. */
export interface CodeReportCoverageFunction {
  readonly path: RelativePath;
  readonly qualifiedName: string;
  readonly occurrence: number;
  readonly measure: "crap" | "uncovered";
  readonly outcome: CodeOutcome;
  readonly value: number | null;
  readonly changedAt: RevisionNumber;
}

/** `CodeReport.coverage`. */
export interface CodeReportCoverage {
  /** `crap.threshold` the states were judged at. */
  readonly threshold: number | null;
  /** Functions over CRAP, newest first; with `--changed`, every changed CRAP or uncovered state. */
  readonly functions: readonly CodeReportCoverageFunction[];
  /** Functions no in-process test that Squeal runs reaches, in the paths asked for. */
  readonly uncovered: number;
  /** Files waiting for their loaders' records, or unknown, keeping their last judged states. */
  readonly notJudged: number;
  /** Row 015-75: the files not measured, out of `notJudged`, and the runners that give them no record; absent, none. */
  readonly notMeasured?: { readonly files: number; readonly runners: readonly string[] };
  /** Row 015-64: the checks judged; absent when both are. */
  readonly checks?: readonly CoverageMeasure[];
}

/** Row 015-64: whether the summary's `coverage.exclude` leaves `path` out. */
const excludedBy = (summary: CoverageSummary) => createInputMatcher(summary.exclude ?? []);

const idOf = (s: { path: RelativePath; qualifiedName: string; occurrence: number }) =>
  `${s.path}\0${functionKey(s)}`;

/** Row 015-75: the names of the runners that give a file no record, when only such runners leave it unknown. */
function notMeasuredBy(summary: CoverageSummary, path: RelativePath): string[] | null {
  const file = summary.files[path];
  if (file?.state !== "unknown" || file.runners === undefined) return null;
  return file.runners.map(runnerName);
}

/**
 * Review 0.1.354 B1: a state a current record proved. A function, or a
 * file, with one reads its states and evidence, not "not measured", beside
 * a loader whose runner gives no record (D9, A pass proven early).
 */
const measured = (s: CodeKnownState | undefined) => s?.outcome === "pass" || s?.outcome === "fail";

/** Each function's coverage states and evidence in `paths`' files, by `path NUL name NUL occurrence`. */
export function coverageByFunction(
  code: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
): ReadonlyMap<string, CodeReportCoverageOf> {
  const summary = paths.length === 0 ? null : readSummary(code.meta, worktreeId);
  if (summary === null) return new Map();
  const states = code.states.list(worktreeId, { paths });
  const by = new Map<string, Partial<Record<CodeMeasure, CodeKnownState>>>();
  const excluded = excludedBy(summary);
  const out = new Map<string, CodeReportCoverageOf>();
  for (const s of states) {
    const id = idOf({ ...s.check });
    if (excluded(s.check.path)) out.set(id, { excluded: true });
    else by.set(id, { ...by.get(id), [s.measure]: s });
  }
  const evidence = new Map(paths.map((p) => [p, readEvidence(code.meta, worktreeId, p)]));
  for (const [id, m] of by) {
    const judged = m.crap ?? m.uncovered;
    if (judged === undefined) continue;
    const notMeasured = notMeasuredBy(summary, judged.check.path);
    if (notMeasured !== null && !measured(m.crap) && !measured(m.uncovered)) {
      out.set(id, { notMeasured });
      continue;
    }
    const fn = evidence.get(judged.check.path)?.functions[functionKey(judged.check)];
    const states = {
      ...(m.crap === undefined ? {} : { crap: { outcome: m.crap.outcome, value: m.crap.value } }),
      ...(m.uncovered === undefined ? {} : { uncovered: m.uncovered.outcome }),
    };
    if (fn === undefined) {
      out.set(id, states);
      continue;
    }
    const [lines, covered, testFiles, ...first] = fn;
    out.set(id, { ...states, lines, covered, testFiles, first });
  }
  return out;
}

/**
 * The coverage part of a report; `undefined` before the coverage step
 * judged here. `since`: with `--changed`, the registration's bound.
 * `told`: with `--told`, the states told in full that fail (`toldOver`),
 * which it lists and counts in place of every state.
 */
export function coverageReport(
  code: CodeStore,
  worktreeId: WorktreeId,
  keep: (path: RelativePath) => boolean,
  since: CodeBound | null | undefined,
  told?: readonly CodeKnownState[],
): CodeReportCoverage | undefined {
  const summary = readSummary(code.meta, worktreeId);
  if (summary === null) return undefined;
  const states = (
    told ?? COVERAGE_MEASURES.flatMap((measure) => code.states.list(worktreeId, { measure }))
  ).filter((s) => keep(s.check.path));
  const changed = (s: CodeKnownState) => {
    if (told !== undefined) return true;
    if (since === undefined) return s.measure === "crap" && s.outcome === "fail";
    if (since === null) return false;
    const last = lastTransition(code, worktreeId, s.check, s.measure);
    return last !== null && isOwn(since, last.revision);
  };
  const functions = states
    .filter(changed)
    .map(
      (s): CodeReportCoverageFunction => ({
        path: s.check.path,
        qualifiedName: s.check.qualifiedName,
        occurrence: s.check.occurrence,
        measure: s.measure as "crap" | "uncovered",
        outcome: s.outcome,
        value: s.value,
        changedAt: s.changedAt,
      }),
    )
    .sort((a, b) => b.changedAt - a.changedAt || a.path.localeCompare(b.path));
  const crap = states.find((s) => s.measure === "crap" && s.threshold !== null);
  const waiting = Object.keys(summary.files).filter(
    (path) => keep(path) && summary.files[path]?.state !== "judged",
  );
  const proved = new Set(states.filter(measured).map((s) => s.check.path));
  const unmeasuredBy = (path: RelativePath) =>
    proved.has(path) ? null : notMeasuredBy(summary, path);
  const unmeasured = waiting.flatMap((path) => unmeasuredBy(path) ?? []);
  const notMeasured = waiting.filter((path) => unmeasuredBy(path) !== null).length;
  return {
    threshold: crap?.threshold ?? null,
    functions,
    uncovered: states.filter((s) => s.measure === "uncovered" && s.outcome === "fail").length,
    notJudged: waiting.length - notMeasured,
    ...(notMeasured === 0
      ? {}
      : { notMeasured: { files: notMeasured, runners: [...new Set(unmeasured)].sort() } }),
    ...(summary.checks === undefined ? {} : { checks: summary.checks }),
  };
}

const score = (value: number | null) =>
  value === null ? "not judged" : Number.isInteger(value) ? `${value}` : value.toFixed(1);

/** The words a function's line ends with for its coverage, with paths; only for the checks judged. */
export function coverageWords(c: CodeReportCoverageOf | undefined): string {
  if (c === undefined) return "";
  if (c.excluded === true) return "; coverage not checked (coverage.exclude)";
  if (c.notMeasured !== undefined) return `; not measured: ${noCoverageWords(c.notMeasured)}`;
  const waits = (outcome: CodeOutcome | undefined) =>
    outcome === "pending" || outcome === "unknown";
  if (waits(c.crap?.outcome)) return `; CRAP ${c.crap?.outcome}`;
  if (waits(c.uncovered)) return `; untested ${c.uncovered}`;
  const ran =
    c.testFiles === undefined || c.lines === undefined || c.covered === undefined
      ? c.uncovered === "pass"
        ? TESTED
        : null
      : `${c.lines === 0 ? 100 : Math.round((c.covered / c.lines) * 100)}% of its lines ran${c.testFiles === 0 ? "" : ` in ${plural(c.testFiles, "test file")}`}`;
  const words = [
    ...(c.crap === undefined
      ? []
      : [`CRAP ${score(c.crap.value)}${c.crap.outcome === "fail" ? ", over" : ""}`]),
    ...(c.uncovered === "fail" ? [UNTESTED] : ran === null ? [] : [ran]),
  ];
  return words.map((w) => `; ${w}`).join("");
}

/** With `--told` (row 015-40): the head, each measure apart as the told line counts them. */
function toldHead(c: CodeReportCoverage, who: string): string {
  const crap = c.functions.filter((f) => f.measure === "crap").length;
  const words = toldOverWords({
    count: 0,
    threshold: 0,
    ...(crap === 0 ? {} : { crap: { count: crap, threshold: c.threshold ?? 0 } }),
    ...(c.uncovered === 0 ? {} : { uncovered: c.uncovered }),
  });
  return `Coverage: ${words} that ${who} told about`;
}

/** Without paths or a flag: the functions over CRAP and those untested, for the checks judged. */
function allHead(c: CodeReportCoverage, command: string): string {
  const checks = c.checks ?? COVERAGE_MEASURES;
  if (checks.length === 0)
    return "Coverage: no check is on: crap.enabled and coverage.untested are false";
  const parts = [
    ...(checks.includes("crap")
      ? [`${plural(c.functions.length, "function")} over ${c.threshold ?? "the threshold"}`]
      : []),
    ...(checks.includes("uncovered") ? [`${plural(c.uncovered, "function")} untested`] : []),
  ];
  const label = checks.includes("crap") ? "CRAP" : "Coverage";
  return `${label}: ${parts.join("; ")}; ${command} code <path> shows them by file`;
}

/** The coverage part's lines, without paths; `told`, with `--told`, who was told. */
export function coverageLines(
  c: CodeReportCoverage | undefined,
  changed: boolean,
  command: string,
  told?: string,
): string[] {
  if (c === undefined) return [];
  const head =
    told !== undefined
      ? toldHead(c, told)
      : changed
        ? `Coverage: ${plural(c.functions.length, "change")} since the registration`
        : allHead(c, command);
  const wait =
    c.notJudged === 0
      ? []
      : [`  ${plural(c.notJudged, "file")} not judged yet keep their last states`];
  // Row 015-75: no state is kept for them.
  const unmeasured =
    c.notMeasured === undefined
      ? []
      : [
          `  ${plural(c.notMeasured.files, "file")} not measured: ${noCoverageWords(c.notMeasured.runners)}`,
        ];
  return [
    head,
    ...c.functions.map((f) => {
      const name = functionName({ ...f, kind: "code" });
      const what =
        f.measure === "crap"
          ? `CRAP ${score(f.value)}, ${f.outcome}`
          : f.outcome === "fail"
            ? UNTESTED
            : TESTED;
      return `  ${f.path}  ${name}  ${what}, since revision ${f.changedAt}`;
    }),
    ...wait,
    ...unmeasured,
  ];
}
