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
 * files that ran it, as evidence, never as a target to reach. Row 015-65
 * (D9 Delivery, amended 2026-10-26): the lines call `uncovered` `untested`
 * and lead with the reason.
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

/** Row 015-65 (D9 Delivery, amended 2026-10-26): the reason an `untested` line leads with. */
const NOT_RUN = "no test runs it in its own process";
const NOT_LOADED = "no test file loads this file";

/** Row 015-65: the first line in a session that says a test may start a process also says this. */
export const EXCLUDE_HINT =
  "To stop checking such files, add them to coverage.exclude in squeal.config.json.";

/** Row 015-65: a delivery calls the `uncovered` measure `untested`; the store keeps its name. */
export const labelOf = (measure: CodeMeasure) =>
  measure === "crap" ? "CRAP" : measure === "uncovered" ? "untested" : measure;

/**
 * How a line names its function: `at` and its joiner on a line of its own,
 * nothing inside a block (D6 **One function, several changes**), where the
 * block's first line names it.
 */
export const named = (at: string | null, joiner: string) => (at === null ? "" : `${at}${joiner}`);

const score = (value: number | null) =>
  value === null ? "unknown" : Number.isInteger(value) ? `${value}` : value.toFixed(1);

const share = ({ lines, covered }: CodeCoverageEvidence) =>
  lines === 0
    ? "it has no line that runs"
    : `${Math.round((covered / lines) * 100)}% of its lines ran`;

/** The test files that ran it: the first by path, then how many more. */
function testFiles(e: CodeCoverageEvidence): string {
  const rest = e.testFiles - e.first.length;
  const names = e.first.join(", ");
  return rest > 0 ? `${names} and ${plural(rest, "more test file")}` : names;
}

/** What else a function's block tells, so a line leaves out what another line of it says. */
export interface BlockContext {
  /** The block's other entries; empty for a line of its own. */
  readonly others: readonly CodeDeltaEntry[];
  /** Row 015-65: whether this line, when it says a test may start a process, also names `coverage.exclude`. */
  readonly hint: () => boolean;
}

/** Another line of the block states `measure`'s value. */
const shows = (others: readonly CodeDeltaEntry[], measure: CodeMeasure) =>
  others.some((e) => e.measure === measure && e.kind !== "removed");

/** Another line of the block states the complexity: its own, or a failing CRAP line's evidence. */
const showsComplexity = (others: readonly CodeDeltaEntry[]) =>
  shows(others, "complexity") ||
  others.some((e) => e.measure === "crap" && e.kind !== "removed" && e.kind !== "fail-to-pass");

/**
 * A CRAP line's evidence: the complexity, then the share of the function's
 * lines that ran and the test files that ran it, or that no test runs it;
 * in a block, without what its other lines say.
 */
function crapEvidence(entry: CodeDeltaEntry, others: readonly CodeDeltaEntry[]): string {
  const e = entry.evidence;
  if (e === undefined) return "";
  const ran = e.testFiles > 0 ? `${share(e)} in ${testFiles(e)}` : NOT_RUN;
  const parts = [
    ...(shows(others, "complexity") ? [] : [`complexity ${e.complexity}`]),
    ...(e.testFiles === 0 && shows(others, "uncovered") ? [] : [ran]),
  ];
  return parts.length === 0 ? "" : ` (${parts.join("; ")})`;
}

/** An `untested` line's evidence: the complexity and, while it is judged, the CRAP. */
function untestedEvidence(e: CodeCoverageEvidence, others: readonly CodeDeltaEntry[]): string {
  const parts = [
    ...(showsComplexity(others) ? [] : [`complexity ${e.complexity}`]),
    ...(e.crap === undefined || shows(others, "crap") ? [] : [`CRAP ${score(e.crap)}`]),
  ];
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/**
 * D9 Delivery as amended 2026-10-26: why no test runs it, what Squeal saw,
 * then the evidence; when a test file loads its file and none of the
 * file's functions ran, that the test files may run it in a process. Ends
 * with a full stop only then.
 */
function untestedWhy(entry: CodeDeltaEntry, after: string, block: BlockContext): string {
  const e = entry.evidence;
  if (e === undefined) return `${NOT_RUN}${after}`;
  const loads =
    e.loaders === undefined
      ? `${NOT_RUN}${after}`
      : e.loaders === 0
        ? `${NOT_LOADED}${after}`
        : `${NOT_RUN}${after}; ${plural(e.loaders, "test file")} ${e.loaders === 1 ? "loads" : "load"} this file`;
  const why = `${loads}${untestedEvidence(e, block.others)}`;
  if (e.processes !== true) return why;
  const may =
    e.loaders === 1
      ? "The test file may run it in a process it starts"
      : "They may run it in a process they start";
  const hint = block.hint() ? ` ${EXCLUDE_HINT}` : "";
  return `${why}. ${may}, which Squeal does not measure.${hint}`;
}

/** `rest` after `text`: a new sentence after a full stop, else after a semicolon. */
const then = (text: string, rest: string) => `${text}${text.endsWith(".") ? " " : "; "}${rest}`;

/**
 * Row 015-40: 015-21's end of a STILL FAIL line, for these measures: the
 * agent hears of the function again only once it passes.
 */
function quietHint(entry: CodeDeltaEntry, command: string): string {
  const until =
    entry.measure === "uncovered"
      ? "a test runs it in its own process"
      : `it is at or under ${entry.threshold}`;
  const shows = entry.measure === "uncovered" ? "its coverage" : "its CRAP";
  return `Squeal stays quiet about it until ${until}, and ${command} code ${entry.check.path} shows ${shows}.`;
}

/**
 * Row 015-40, D6's last rule and 015-21: an edit that left the function
 * failing. `edited`: it failed before the session heard of it, so the line
 * says it already did; `edited-after-fail`: after a FAIL told.
 */
function stillFailLine(
  entry: CodeDeltaEntry,
  at: string | null,
  command: string,
  block: BlockContext,
): string {
  const before = entry.kind === "edited";
  const what =
    entry.measure === "uncovered"
      ? untestedWhy(
          entry,
          before ? " after the edit, nor did one before it" : " after the edit",
          block,
        )
      : `${score(entry.value)} after the edit${before ? `; it was already over ${entry.threshold} before it` : `, over ${entry.threshold}`}${crapEvidence(entry, block.others)}`;
  return `STILL FAIL ${labelOf(entry.measure)}: ${named(at, ": ")}${then(what, quietHint(entry, command))}`;
}

/** Who runs a function an `untested` PASS tells of. */
function runsIt(e: CodeCoverageEvidence | undefined): string {
  if (e === undefined || e.testFiles === 0) return "a test runs it in its own process";
  return e.testFiles === 1
    ? `${testFiles(e)} runs it in its own process`
    : `${testFiles(e)} run it in their own processes`;
}

/**
 * One told change of a `crap` or `uncovered` state; `at` is the function
 * and where it is, `null` inside its block.
 */
export function coverageEntryLine(
  entry: CodeDeltaEntry,
  at: string | null,
  command: string,
  block: BlockContext,
): string {
  const label = labelOf(entry.measure);
  if (entry.kind === "removed")
    return `RESOLVED ${label}: ${named(at, " is ")}no longer in the code`;
  if (entry.kind === "edited" || entry.kind === "edited-after-fail") {
    return stillFailLine(entry, at, command, block);
  }
  if (entry.measure === "uncovered") {
    return entry.kind === "fail-to-pass"
      ? `PASS ${label}: ${named(at, ": ")}${runsIt(entry.evidence)}`
      : `FAIL ${label}: ${named(at, ": ")}${untestedWhy(entry, "", block)}`;
  }
  if (entry.kind === "fail-to-pass") {
    return `PASS ${label}: ${named(at, ": ")}${score(entry.value)}, at or under ${entry.threshold}`;
  }
  return `FAIL ${label}: ${named(at, ": ")}${score(entry.value)}, over ${entry.threshold}${crapEvidence(entry, block.others)}`;
}

/** A change of a `crap` or `uncovered` state. */
export const isCoverage = (entry: { readonly measure: CodeMeasure }) =>
  entry.measure !== "complexity";
