import type { CoverageChecks } from "../core/code/crap/checks.js";
import { COVERAGE_MEASURES } from "../core/code/crap/seed.js";
import {
  type CoverageMeasure,
  type CoverageSummary,
  type FunctionEvidence,
  functionKey,
  readEvidence,
  readSummary,
} from "../core/code/crap/summary.js";
import type { CodeStore } from "../core/code/store/types.js";
import { LOWER_BOUND, UNMEASURED } from "../core/delivery/code-coverage.js";
import { lastTransition } from "../core/delivery/code-deliver.js";
import { type CodeBound, isOwn } from "../core/delivery/code-delta.js";
import { functionName, toldOverWords } from "../core/delivery/code-format.js";
import { noCoverageWords, runnerName } from "../core/delivery/code-runners.js";
import { createInputMatcher } from "../core/keys/glob.js";
import { plural } from "../core/text.js";
import type { CodeKnownState, CodeMeasure, CodeOutcome } from "../core/types/code.js";
import type { RelativePath, RevisionNumber, WorktreeId } from "../core/types/common.js";
import { type CrapShown, crapFor } from "./code-crap-reason.js";

/*
 * Spec 015 D9 (row 015-12): `squeal code`'s coverage part, while the
 * daemon's coverage step judges here. With paths, each function's CRAP,
 * whether a test runs it in the test's own thread, and its evidence;
 * without, the functions over CRAP and the number untested, with
 * `--changed` those whose state changed, and with `--told` those failing
 * that the session was told of in full (row 015-40). Row 015-64: only the
 * checks judged, and a file `coverage.exclude` leaves out says so. Row
 * 015-80: a part that shows a failing function says what Squeal does not
 * measure. Spec 020 D12.7 (row 020-10b): where the states were judged with
 * `coverage.children`, the words count the processes and threads a test
 * starts, as a lower bound.
 */

/** Row 015-64 (D9 as amended 2026-10-26, 2026-10-27): what a function `uncovered` reads as. */
const UNTESTED = "untested: no test runs it in the test's own thread";
const TESTED = "a test runs it in its own thread";

/** Spec 020 D12.7: the same with `coverage.children`. */
const UNTESTED_CHILDREN =
  "untested: no test runs it, in the test's own thread or in a process or thread the test starts";
const TESTED_CHILDREN =
  "a test runs it, in the test's own thread or in a process or thread the test starts";

const untested = (children: true | undefined) => (children ? UNTESTED_CHILDREN : UNTESTED);
const tested = (children: true | undefined) => (children ? TESTED_CHILDREN : TESTED);

/**
 * Spec 020 D11.5 (row 020-07a): a file no test Squeal runs loads is not
 * measured, never untested. A fact about the tests Squeal runs (row
 * 015-103): a test outside its runners can load it.
 */
const NOT_LOADED = "no test Squeal runs loads this file";
const NOT_LOADED_FILES = "no test Squeal runs loads them";

/** Row 015-80 (D9, amended 2026-10-27): so a failing state does not read as "no test runs it". */
const MEASURED = `  Coverage counts what ran in the test's own thread. ${UNMEASURED}`;

/** Spec 020 D12.7 (request 7f914e71): `MEASURED` with `coverage.children`. */
const MEASURED_CHILDREN = `  Coverage counts what ran in the test's own thread and in the processes and threads it started. ${LOWER_BOUND}`;

/**
 * One function's coverage states and evidence. Row 015-64: `crap` and
 * `uncovered` are absent while their check is off; `excluded` is set, and
 * both absent, for a file `coverage.exclude` leaves out.
 */
export interface CodeReportCoverageOf {
  /**
   * Row 015-101: `reason`, set only on an unknown or pending CRAP, says why
   * in a few words. Row 015-104: a function with a complexity that the
   * coverage step has not judged reads `pending`, with `value` `null`.
   */
  readonly crap?: CrapShown;
  readonly uncovered?: CodeOutcome;
  readonly excluded?: true;
  /**
   * Row 015-75: the file is unknown since runners whose runs give no record
   * load it, by their names, and no current record proved this function's
   * states (review 0.1.354 B1); then nothing else is set.
   */
  readonly notMeasured?: readonly string[];
  /**
   * Spec 020 D11.5: the file is unknown since no test file Squeal runs
   * loads it, and no state proved this function's; then nothing else is set.
   */
  readonly notLoaded?: true;
  /** At the file's last judgement; absent while it has none. */
  readonly lines?: number;
  readonly covered?: number;
  readonly testFiles?: number;
  readonly first?: readonly RelativePath[];
  /** Spec 020 D12.7: judged with `coverage.children`; absent, without. */
  readonly children?: true;
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
  /**
   * Spec 020 D11.5: the files with a counted function that no test file
   * loads, so not measured; absent, none. No such file is in `notJudged`.
   */
  readonly notLoaded?: number;
  /** Row 015-64: the checks judged; absent when both are. */
  readonly checks?: readonly CoverageMeasure[];
  /** Spec 020 D12.7: the states were judged with `coverage.children`; absent, without. */
  readonly children?: true;
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

/** Spec 020 D11.5: no test file Squeal runs loads the file. */
const notLoaded = (summary: CoverageSummary, path: RelativePath) => {
  const file = summary.files[path];
  return file?.state === "unknown" && file.cause === "no-loader";
};

/**
 * Review 0.1.354 B1: a state a current record proved. A function, or a
 * file, with one reads its states and evidence, not "not measured", beside
 * a loader whose runner gives no record (D9, A pass proven early).
 */
const measured = (s: CodeKnownState | undefined) => s?.outcome === "pass" || s?.outcome === "fail";

/**
 * A function whose file is not measured, while no state proved it:
 * runners that give no record load the file (row 015-75), or no test file
 * does (spec 020 D11.5); `null` otherwise.
 */
function unmeasuredOf(
  summary: CoverageSummary,
  path: RelativePath,
  m: Partial<Record<CodeMeasure, CodeKnownState>>,
): CodeReportCoverageOf | null {
  if (measured(m.crap) || measured(m.uncovered)) return null;
  const notMeasured = notMeasuredBy(summary, path);
  if (notMeasured !== null) return { notMeasured };
  return notLoaded(summary, path) ? { notLoaded: true } : null;
}

/** A function's states with its evidence at the file's last judgement, when it has some. */
function withEvidence(
  states: CodeReportCoverageOf,
  fn: FunctionEvidence | undefined,
): CodeReportCoverageOf {
  if (fn === undefined) return states;
  const [lines, covered, testFiles, ...first] = fn;
  return { ...states, lines, covered, testFiles, first };
}

/**
 * What `squeal code` knows beside the store (review 0.1.408): the coverage
 * checks the policy turns on, `null` with coverage off, for the reads
 * before the first coverage step wrote a summary; and how the text names
 * the CLI, as status names it.
 */
export interface CoverageReadOptions {
  readonly checks?: CoverageChecks | null;
  readonly command?: string;
}

/**
 * Review 0.1.408 B1: before the first coverage step, with CRAP on, each
 * counted function of a file the policy does not exclude reads CRAP
 * pending; an excluded file, CRAP off or coverage off read nothing.
 */
function beforeFirstStep(
  code: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
  { checks, command }: CoverageReadOptions,
): ReadonlyMap<string, CodeReportCoverageOf> {
  const out = new Map<string, CodeReportCoverageOf>();
  if (checks == null || !checks.measures.includes("crap")) return out;
  for (const s of code.states.list(worktreeId, { paths, measure: "complexity" })) {
    if (checks.excluded(s.check.path)) continue;
    const crap = crapFor({ complexity: s }, undefined, undefined, true, command);
    if (crap !== null) out.set(idOf({ ...s.check }), { crap });
  }
  return out;
}

/** Each function's coverage states and evidence in `paths`' files, by `path NUL name NUL occurrence`. */
export function coverageByFunction(
  code: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
  options: CoverageReadOptions = {},
): ReadonlyMap<string, CodeReportCoverageOf> {
  if (paths.length === 0) return new Map();
  const summary = readSummary(code.meta, worktreeId);
  if (summary === null) return beforeFirstStep(code, worktreeId, paths, options);
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
  const blobs = new Map(code.files.list(worktreeId, paths).map((f) => [f.path, f.blob]));
  const crapOn = (summary.checks ?? COVERAGE_MEASURES).includes("crap");
  for (const [id, m] of by) {
    const any = m.crap ?? m.uncovered ?? m.complexity;
    if (any === undefined) continue;
    const { path } = any.check;
    // Row 015-104: with a complexity and no CRAP state yet, CRAP pending with its wait.
    const crap = crapFor(m, summary.files[path], blobs.get(path), crapOn, options.command);
    if (crap === null && m.uncovered === undefined) continue;
    const unmeasured = unmeasuredOf(summary, path, m);
    if (unmeasured !== null) {
      out.set(id, unmeasured);
      continue;
    }
    const states = {
      ...(crap === null ? {} : { crap }),
      ...(m.uncovered === undefined ? {} : { uncovered: m.uncovered.outcome }),
      ...(summary.children === true ? { children: true as const } : {}),
    };
    out.set(id, withEvidence(states, evidence.get(path)?.functions[functionKey(any.check)]));
  }
  return out;
}

/** How many of `paths` hold a counted function: a file with none is not worth a line. */
function withFunctions(code: CodeStore, worktreeId: WorktreeId, paths: readonly RelativePath[]) {
  if (paths.length === 0) return 0;
  const counted = code.states.list(worktreeId, { paths, measure: "complexity" });
  return new Set(counted.map((s) => s.check.path)).size;
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
  const loaderless = waiting.filter((path) => !proved.has(path) && notLoaded(summary, path));
  const unloaded = withFunctions(code, worktreeId, loaderless);
  return {
    threshold: crap?.threshold ?? null,
    functions,
    uncovered: states.filter((s) => s.measure === "uncovered" && s.outcome === "fail").length,
    notJudged: waiting.length - notMeasured - loaderless.length,
    ...(notMeasured === 0
      ? {}
      : { notMeasured: { files: notMeasured, runners: [...new Set(unmeasured)].sort() } }),
    ...(unloaded === 0 ? {} : { notLoaded: unloaded }),
    ...(summary.checks === undefined ? {} : { checks: summary.checks }),
    ...(summary.children === true ? { children: true as const } : {}),
  };
}

const score = (value: number | null) =>
  value === null ? "not judged" : Number.isInteger(value) ? `${value}` : value.toFixed(1);

/** Why a function is not measured, as its line ends; `null` when it is. */
function notMeasuredWords(c: CodeReportCoverageOf): string | null {
  if (c.notMeasured !== undefined) return `; not measured: ${noCoverageWords(c.notMeasured)}`;
  return c.notLoaded === true ? `; not measured: ${NOT_LOADED}` : null;
}

/** The words a function's line ends with for its coverage, with paths; only for the checks judged. */
export function coverageWords(c: CodeReportCoverageOf | undefined): string {
  if (c === undefined) return "";
  if (c.excluded === true) return "; coverage not checked (coverage.exclude)";
  const unmeasured = notMeasuredWords(c);
  if (unmeasured !== null) return unmeasured;
  const waits = (outcome: CodeOutcome | undefined) =>
    outcome === "pending" || outcome === "unknown";
  if (waits(c.crap?.outcome)) {
    return `; CRAP ${c.crap?.outcome}${c.crap?.reason === undefined ? "" : `: ${c.crap.reason}`}`;
  }
  if (waits(c.uncovered)) return `; untested ${c.uncovered}`;
  const ran =
    c.testFiles === undefined || c.lines === undefined || c.covered === undefined
      ? c.uncovered === "pass"
        ? tested(c.children)
        : null
      : `${c.lines === 0 ? 100 : Math.round((c.covered / c.lines) * 100)}% of its lines ran${c.testFiles === 0 ? "" : ` in ${plural(c.testFiles, "test file")}`}`;
  const words = [
    ...(c.crap === undefined
      ? []
      : [`CRAP ${score(c.crap.value)}${c.crap.outcome === "fail" ? ", over" : ""}`]),
    ...(c.uncovered === "fail" ? [untested(c.children)] : ran === null ? [] : [ran]),
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
  const unloaded =
    c.notLoaded === undefined
      ? []
      : [`  ${plural(c.notLoaded, "file")} not measured: ${NOT_LOADED_FILES}`];
  const failing = c.uncovered > 0 || c.functions.some((f) => f.outcome === "fail");
  return [
    head,
    ...c.functions.map((f) => {
      const name = functionName({ ...f, kind: "code" });
      const what =
        f.measure === "crap"
          ? `CRAP ${score(f.value)}, ${f.outcome}`
          : f.outcome === "fail"
            ? untested(c.children)
            : tested(c.children);
      return `  ${f.path}  ${name}  ${what}, since revision ${f.changedAt}`;
    }),
    ...(failing ? [c.children ? MEASURED_CHILDREN : MEASURED] : []),
    ...wait,
    ...unmeasured,
    ...unloaded,
  ];
}
