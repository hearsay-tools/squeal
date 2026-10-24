import {
  COVERAGE_MEASURES,
  functionKey,
  readEvidence,
  readSummary,
} from "../core/code/crap/index.js";
import type { CodeStore } from "../core/code/store/types.js";
import { NOT_REACHED } from "../core/delivery/code-coverage.js";
import { lastTransition } from "../core/delivery/code-deliver.js";
import { type CodeBound, isOwn } from "../core/delivery/code-delta.js";
import { functionName, toldOverWords } from "../core/delivery/code-format.js";
import { plural } from "../core/text.js";
import type { CodeKnownState, CodeMeasure, CodeOutcome } from "../core/types/code.js";
import type { RelativePath, RevisionNumber, WorktreeId } from "../core/types/index.js";

/*
 * Spec 015 D9 (row 015-12): `squeal code`'s coverage part, while the
 * daemon's coverage step judges here. With paths, each function's CRAP,
 * whether an in-process test reaches it, and its evidence; without, the
 * functions over CRAP and the number no in-process test reaches, with
 * `--changed` those whose state changed, and with `--told` those failing
 * that the session was told of in full (row 015-40).
 */

/** One function's coverage states and evidence. */
export interface CodeReportCoverageOf {
  readonly crap: { readonly outcome: CodeOutcome; readonly value: number | null };
  readonly uncovered: CodeOutcome;
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
}

const idOf = (s: { path: RelativePath; qualifiedName: string; occurrence: number }) =>
  `${s.path}\0${functionKey(s)}`;

/** Each function's coverage states and evidence in `paths`' files, by `path NUL name NUL occurrence`. */
export function coverageByFunction(
  code: CodeStore,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
): ReadonlyMap<string, CodeReportCoverageOf> {
  if (paths.length === 0 || readSummary(code.meta, worktreeId) === null) return new Map();
  const states = code.states.list(worktreeId, { paths });
  const by = new Map<string, Partial<Record<CodeMeasure, CodeKnownState>>>();
  for (const s of states) {
    const id = idOf({ ...s.check });
    by.set(id, { ...by.get(id), [s.measure]: s });
  }
  const out = new Map<string, CodeReportCoverageOf>();
  const evidence = new Map(paths.map((p) => [p, readEvidence(code.meta, worktreeId, p)]));
  for (const [id, m] of by) {
    if (m.crap === undefined || m.uncovered === undefined) continue;
    const fn = evidence.get(m.crap.check.path)?.functions[functionKey(m.crap.check)];
    const states = {
      crap: { outcome: m.crap.outcome, value: m.crap.value },
      uncovered: m.uncovered.outcome,
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
  const waiting = Object.entries(summary.files).filter(
    ([path, f]) => keep(path) && f.state !== "judged",
  );
  return {
    threshold: crap?.threshold ?? null,
    functions,
    uncovered: states.filter((s) => s.measure === "uncovered" && s.outcome === "fail").length,
    notJudged: waiting.length,
  };
}

const score = (value: number | null) =>
  value === null ? "not judged" : Number.isInteger(value) ? `${value}` : value.toFixed(1);

/** The words a function's line ends with for its coverage, with paths. */
export function coverageWords(c: CodeReportCoverageOf | undefined): string {
  if (c === undefined) return "";
  if (c.crap.outcome === "pending" || c.crap.outcome === "unknown")
    return `; CRAP ${c.crap.outcome}`;
  const ran =
    c.uncovered === "fail"
      ? NOT_REACHED
      : c.testFiles === undefined || c.lines === undefined || c.covered === undefined
        ? "an in-process test runs it"
        : `${c.lines === 0 ? 100 : Math.round((c.covered / c.lines) * 100)}% of its lines ran in ${plural(c.testFiles, "test file")}`;
  return `; CRAP ${score(c.crap.value)}${c.crap.outcome === "fail" ? ", over" : ""}; ${ran}`;
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
        : `CRAP: ${plural(c.functions.length, "function")} over ${c.threshold ?? "the threshold"}; ${plural(c.uncovered, "function")} uncovered (${NOT_REACHED}); ${command} code <path> shows them by file`;
  const wait =
    c.notJudged === 0
      ? []
      : [`  ${plural(c.notJudged, "file")} not judged yet keep their last states`];
  return [
    head,
    ...c.functions.map((f) => {
      const name = functionName({ ...f, kind: "code" });
      const what =
        f.measure === "crap"
          ? `CRAP ${score(f.value)}, ${f.outcome}`
          : f.outcome === "fail"
            ? NOT_REACHED
            : "an in-process test reaches it";
      return `  ${f.path}  ${name}  ${what}, since revision ${f.changedAt}`;
    }),
    ...wait,
  ];
}
