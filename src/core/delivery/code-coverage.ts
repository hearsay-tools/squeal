import { COVERAGE_MEASURES, functionKey, readEvidence, readSummary } from "../code/crap/index.js";
import type { CodeStore } from "../code/store/types.js";
import { plural } from "../text.js";
import type { CodeKnownState, CodeMeasure } from "../types/code.js";
import type { CodeCoverageEvidence, CodeDeltaEntry } from "../types/code-delivery.js";
import type { WorktreeId } from "../types/index.js";

/*
 * Spec 015 D9 (row 015-12): the `crap` and `uncovered` kinds of a code
 * delivery. Their states are told as complexity's are (D5 to D7), while
 * the daemon's coverage step keeps them, that is while `coverage.enabled`
 * holds; with it off nothing here is read past one meta key. A FAIL line
 * names the CC, the share of the function's lines that ran and the test
 * files that ran it, as evidence, never as a target to reach.
 */

/** The measures a delivery tells beside `complexity`: none until the coverage step judged here. */
export function coverageMeasures(store: CodeStore, worktreeId: WorktreeId): readonly CodeMeasure[] {
  return readSummary(store.meta, worktreeId) === null ? [] : COVERAGE_MEASURES;
}

/** Every failing state of `measures`. */
export function failingOf(
  store: CodeStore,
  worktreeId: WorktreeId,
  measures: readonly CodeMeasure[],
): CodeKnownState[] {
  return measures.flatMap((measure) => store.states.list(worktreeId, { measure, outcome: "fail" }));
}

/** The evidence of a `crap` or `uncovered` entry at its file's last judgement; `{}` for complexity's. */
export function evidenceOf(
  store: CodeStore,
  worktreeId: WorktreeId,
  entry: Pick<CodeDeltaEntry, "check" | "measure" | "kind">,
): { evidence?: CodeCoverageEvidence } {
  if (entry.measure === "complexity" || entry.kind === "removed") return {};
  const [file] = store.files.list(worktreeId, [entry.check.path]);
  const evidence = readEvidence(store.meta, worktreeId, entry.check.path);
  const fn = evidence?.functions[functionKey(entry.check)];
  if (file === undefined || fn === undefined) return {};
  const count = store.counts.get(file.blob, file.language, file.counterVersion);
  const counted = count?.functions.find(
    (f) => f.qualifiedName === entry.check.qualifiedName && f.occurrence === entry.check.occurrence,
  );
  if (counted === undefined) return {};
  const [lines, covered, testFiles, ...first] = fn;
  return { evidence: { complexity: counted.complexity, lines, covered, testFiles, first } };
}

/** The amended D9 wording (coordinator, 2026-10-24): what the `uncovered` state measures. */
export const NOT_REACHED = "no in-process test that Squeal runs reaches it";

/** Row 015-40: `NOT_REACHED` where a line names several measures (Stop). */
export const NOT_REACHED_SHORT = "no in-process test reaches it";

const score = (value: number | null) =>
  value === null ? "unknown" : Number.isInteger(value) ? `${value}` : value.toFixed(1);

const share = ({ lines, covered }: CodeCoverageEvidence) =>
  lines === 0
    ? "it has no line that runs"
    : `${Math.round((covered / lines) * 100)}% of its lines ran`;

/** The test files that ran it: the first by path, then how many more. */
function testFiles(e: CodeCoverageEvidence): string {
  const rest = e.testFiles - e.first.length;
  const named = e.first.join(", ");
  return rest > 0 ? `${named} and ${plural(rest, "more test file")}` : named;
}

/**
 * What a FAIL line gives as evidence: the CC, then the share of the
 * function's lines that ran and the test files that ran it, or that none
 * reaches it.
 */
function failEvidence(entry: CodeDeltaEntry): string {
  const e = entry.evidence;
  if (e === undefined) return "";
  if (entry.measure === "uncovered") return ` (CC ${e.complexity})`;
  if (e.testFiles === 0) return ` (CC ${e.complexity}); ${NOT_REACHED}`;
  return `: CC ${e.complexity}, ${share(e)} in ${testFiles(e)}`;
}

/**
 * Row 015-40: 015-21's end of a STILL FAIL line, for these measures: the
 * agent hears of the function again only once it passes.
 */
function quietHint(entry: CodeDeltaEntry, command: string): string {
  const until =
    entry.measure === "uncovered"
      ? "an in-process test runs it"
      : `it is at or under ${entry.threshold}`;
  const shows = entry.measure === "uncovered" ? "its coverage" : "its CRAP";
  return `Squeal stays quiet about it until ${until}, and ${command} code ${entry.check.path} shows ${shows}.`;
}

/**
 * Row 015-40, D6's last rule and 015-21: an edit that left the function
 * failing. `edited`: it failed before the session heard of it, so the line
 * says it already did; `edited-after-fail`: after a FAIL told.
 */
function stillFailLine(entry: CodeDeltaEntry, at: string, command: string): string {
  const before = entry.kind === "edited";
  const what =
    entry.measure === "uncovered"
      ? `${at}: ${NOT_REACHED} after the edit${before ? "; none reached it before it either" : ""}`
      : `${at} is ${score(entry.value)} after the edit${before ? `; it was already over ${entry.threshold} before it` : `, over ${entry.threshold}`}`;
  const label = entry.measure === "crap" ? "CRAP" : entry.measure;
  return `STILL FAIL ${label}: ${what}${failEvidence(entry)}; ${quietHint(entry, command)}`;
}

/** One told change of a `crap` or `uncovered` state; `at` is the function and where it is. */
export function coverageEntryLine(entry: CodeDeltaEntry, at: string, command: string): string {
  const label = entry.measure === "crap" ? "CRAP" : entry.measure;
  if (entry.kind === "removed") return `RESOLVED ${label}: ${at} is no longer in the code`;
  if (entry.kind === "edited" || entry.kind === "edited-after-fail") {
    return stillFailLine(entry, at, command);
  }
  if (entry.measure === "uncovered") {
    if (entry.kind !== "fail-to-pass")
      return `FAIL uncovered: ${at}: ${NOT_REACHED}${failEvidence(entry)}`;
    const e = entry.evidence;
    if (e === undefined || e.testFiles === 0)
      return `PASS uncovered: ${at}: an in-process test runs it`;
    return `PASS uncovered: ${at}: ${testFiles(e)} ${e.testFiles === 1 ? "runs" : "run"} it in process`;
  }
  if (entry.kind === "fail-to-pass") {
    return `PASS ${label}: ${at} is ${score(entry.value)}, at or under ${entry.threshold}`;
  }
  return `FAIL ${label}: ${at} is ${score(entry.value)}, over ${entry.threshold}${failEvidence(entry)}`;
}

/** A change of a `crap` or `uncovered` state. */
export const isCoverage = (entry: { readonly measure: CodeMeasure }) =>
  entry.measure !== "complexity";
