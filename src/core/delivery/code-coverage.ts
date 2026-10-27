import { COVERAGE_MEASURES, functionKey, readEvidence, readSummary } from "../code/crap/index.js";
import type { CodeStore } from "../code/store/types.js";
import { plural } from "../text.js";
import type { CodeKnownState, CodeMeasure } from "../types/code.js";
import type {
  CodeCoverageEvidence,
  CodeDeltaEntry,
  CodeFileLoaders,
} from "../types/code-delivery.js";
import type { WorktreeId } from "../types/index.js";

/*
 * Spec 015 D9 (row 015-12): the `crap` and `uncovered` kinds of a code
 * delivery. Their states are told as complexity's are (D5 to D7), while
 * the daemon's coverage step keeps them, that is while `coverage.enabled`
 * holds; with it off nothing here is read past one meta key. A FAIL line
 * names the CC, the share of the function's lines that ran and the test
 * files that ran it, as evidence, never as a target to reach. Row 015-65
 * (D9 Delivery, amended 2026-10-26): the lines call `uncovered` `untested`
 * and lead with the reason. Row 015-80 (D9, amended 2026-10-27, the
 * human's option a): they say what ran in the test's own thread, and that
 * Squeal does not measure worker threads or child processes. Row 015-81
 * (D9, amended 2026-10-27): each line that says why no test runs a
 * function states its file's loaders from one set per path.
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

/** Row 015-65 (D9 Delivery, amended 2026-10-26): the reason an `untested` line leads with. */
const NOT_RUN = "no test runs it in the test's own thread";
const NOT_LOADED = "no test file loads this file";

/**
 * Row 015-80: what a line that says `NOT_RUN` or `NOT_LOADED` also says, so
 * it does not read as "no test runs it". A test can run a file it does not
 * load in a worker thread, from a bundle (`test/lint/provider/helpers.ts`).
 */
export const UNMEASURED = "Squeal does not measure worker threads or child processes.";

/**
 * Row 015-81: the loaders of the entry's file, as the delivery read them
 * for every entry of the path; else as an older release wrote them in its
 * evidence. `undefined` when neither holds them: not read, so not zero.
 */
function fileLoadersOf(entry: CodeDeltaEntry): CodeFileLoaders | undefined {
  if (entry.fileLoaders !== undefined) return entry.fileLoaders;
  const e = entry.evidence;
  if (e?.loaders === undefined) return undefined;
  return e.processes === true ? { count: e.loaders, processes: true } : { count: e.loaders };
}

/** Why no test runs it, `after` the reason, then how many test files load its file when read. */
function notRun(file: CodeFileLoaders | undefined, after: string): string {
  if (file === undefined) return `${NOT_RUN}${after}`;
  if (file.count === 0) return `${NOT_LOADED}${after}`;
  return `${NOT_RUN}${after}; ${plural(file.count, "test file")} ${file.count === 1 ? "loads" : "load"} this file`;
}

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
 * lines that ran and the test files that ran it, or that no test runs it,
 * with its file's loaders when read (row 015-81), and what Squeal does not
 * measure; in a block, without what its other lines say.
 */
function crapEvidence(entry: CodeDeltaEntry, others: readonly CodeDeltaEntry[]): string {
  const e = entry.evidence;
  if (e === undefined) return "";
  const why = e.testFiles === 0 && !shows(others, "uncovered");
  const parts = [
    ...(shows(others, "complexity") ? [] : [`complexity ${e.complexity}`]),
    ...(e.testFiles > 0 ? [`${share(e)} in ${testFiles(e)}`] : []),
    ...(why ? [notRun(fileLoadersOf(entry), "")] : []),
  ];
  if (parts.length === 0) return "";
  return ` (${parts.join("; ")})${why ? `. ${UNMEASURED}` : ""}`;
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
 * then the evidence. Then what Squeal does not measure (row 015-80); when a
 * test file loads its file and none of the file's functions ran, as where
 * the test files may run it. Ends with a full stop.
 */
function untestedWhy(entry: CodeDeltaEntry, after: string, block: BlockContext): string {
  const file = fileLoadersOf(entry);
  const e = entry.evidence;
  const why = `${notRun(file, after)}${e === undefined ? "" : untestedEvidence(e, block.others)}`;
  if (file?.processes !== true) return `${why}. ${UNMEASURED}`;
  const may =
    file.count === 1
      ? "The test file may run it in a worker thread or a process it starts"
      : "They may run it in a worker thread or a process they start";
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
      ? "a test runs it in its own thread"
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
  if (e === undefined || e.testFiles === 0) return "a test runs it in its own thread";
  return e.testFiles === 1
    ? `${testFiles(e)} runs it in its own thread`
    : `${testFiles(e)} run it in their own threads`;
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
