import type { FailedTest } from "../core/code/gate/types.js";
import { type Conditions, conditionWords, hasConditions } from "../core/proof/conditions.js";
import { type ChangedImports, stops } from "../core/proof/imports.js";
import type { ProofCase, Side } from "../core/proof/sides.js";
import { controlReading, failureKind, type SideEnd, type Verdict } from "../core/proof/verdict.js";
import { errorLines } from "../core/status/format-why-replaced.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SideFile } from "./proof-side.js";

/*
 * Spec 023 D5.5 (row 023-08): the proof's report: per named test file its
 * verdict, both sides with where each came from, and the red side's failed
 * tests with their failure text as `squeal why` prints it; the commits,
 * the case and the run count, so an agent can paste it into a pull
 * request. Row 023-11: the conditions, `--repeat`, each side's run count
 * and the rerun line for runs the budget left not started. The JSON is
 * versioned as `status --at`'s is. Row 023-21 (D5.2, issue #247): the
 * `--with` paths per side, a warning per `--with` path no named test
 * imports, an unchanged test's changed imports and the rerun with them.
 */

export interface ProofFile {
  readonly ref: TestFileRef;
  readonly verdict: Verdict;
  readonly reason: string | null;
  readonly red: SideFile;
  /** `null` when the green side was not run: the red side already decided. */
  readonly green: SideFile | null;
  /** Row 023-20 (P7): why the green side did not run; `null` when it is shown. */
  readonly greenNotRun: string | null;
  /** Row 023-20 (P9): the red side once without the conditions; `null` when it did not run. */
  readonly control: SideFile | null;
  /** P9: why the control run did not run, under a condition; `null` otherwise. */
  readonly controlNotRun: string | null;
  /** Row 023-21: the changed imports of the file while it is unchanged; `null` otherwise. */
  readonly imports: ChangedImports | null;
}

export interface ProofReport {
  /** `null` when no named file was keyed at `HEAD`, so no case was decided. */
  readonly case: ProofCase | null;
  readonly base: string;
  readonly head: string;
  /** `null` with no case. */
  readonly red: Side | null;
  readonly green: Side;
  /** Each side's checkout time; red and the control run (row 023-20) `null` when they made none. */
  readonly checkoutMs: {
    readonly red: number | null;
    readonly control: number | null;
    readonly green: number;
  };
  /** Paths the working tree holds otherwise than `HEAD` (review wave-8 B2: any path, not only loads). */
  readonly dirty: readonly RelativePath[];
  readonly timeoutSeconds: number;
  readonly usedMs: number;
  /** How many side runs of a file this call made. */
  readonly runs: number;
  readonly files: readonly ProofFile[];
  /** Row 023-11 (D5.3): the conditions both sides ran under. */
  readonly conditions: Conditions;
  /** Row 023-11 (D5.4): `--repeat`. */
  readonly repeat: number;
  /** Row 023-11: the files the budget left a run of not started. */
  readonly notRun: number;
  /** 020's rerun line, with a longer `--timeout`; `null` when every run started. */
  readonly rerun: string | null;
  /** Row 023-21: the `--with` paths, from the root; each side holds them at its test version. */
  readonly with: readonly RelativePath[];
  /** Row 023-21: the `--with` paths no named test's closure at `HEAD` loads. */
  readonly withUnused: readonly RelativePath[];
  /** Row 023-21: the same command with `--with` for each changed helper; `null` when no file stopped. */
  readonly withRerun: string | null;
}

const short = (sha: string) => sha.slice(0, 9);

/**
 * A side in words: `the test at X over the code at Y`, or `X` when both
 * are one commit; row 023-21: with the `--with` paths at the test version.
 */
export function sideText(side: Side, withPaths: readonly RelativePath[] = []): string {
  const text =
    side.tests === side.code
      ? `the test and code at ${short(side.code)}`
      : `the test at ${short(side.tests)} over the code at ${short(side.code)}`;
  return withPaths.length === 0
    ? text
    : `${text}, with ${withPaths.join(", ")} at ${short(side.tests)} as test code`;
}

const FROM_TEXT = {
  store: "stored result",
  run: "run by this command",
} as const;

function endText(side: SideFile): string {
  const { end } = side;
  const what =
    end.end === "unknown"
      ? end.reason.startsWith("not run")
        ? end.reason
        : `unknown (${end.reason})`
      : end.end === "prepare"
        ? "prepare failed"
        : end.end;
  const from = side.from === null ? "" : `, ${FROM_TEXT[side.from]}`;
  const stored =
    side.from !== "run" ? "" : side.stored ? ", stored" : `, not stored (${side.notStored ?? ""})`;
  const runs = side.runs > 1 ? `, ${side.runs} runs` : "";
  return `${what}${from}${stored}${runs}`;
}

function failuresOf(end: SideEnd): readonly FailedTest[] {
  return end.end === "fail" ? end.failures : [];
}

const INDENT = "    ";

/** Each side's checkout time, in seconds. */
function checkoutText(ms: ProofReport["checkoutMs"]): string {
  const s = (n: number) => `${(n / 1000).toFixed(1)} s`;
  const red = ms.red === null ? "" : `red ${s(ms.red)}, `;
  const control = ms.control === null ? "" : `red without the conditions ${s(ms.control)}, `;
  return `checkouts: ${red}${control}green ${s(ms.green)}`;
}

/** How many dirty paths the text names before it counts the rest. */
const NAMED_DIRTY = 5;

function listed(paths: readonly RelativePath[]): string {
  const named = paths.slice(0, NAMED_DIRTY).join(", ");
  const more = paths.length - NAMED_DIRTY;
  return more > 0 ? `${named} and ${more} more` : named;
}

/** D5.5's text: a header, each file's verdict with both sides and the red side's failures, counts. */
export function formatProof(report: ProofReport): string {
  const lines = [
    `squeal proof (case ${report.case ?? "not decided"}): base ${short(report.base)}, HEAD ${short(report.head)}`,
    `Red: ${report.red === null ? "none" : sideText(report.red, report.with)}. Green: ${sideText(report.green, report.with)}; ${checkoutText(report.checkoutMs)}.`,
  ];
  for (const path of report.withUnused)
    lines.push(`Warning: --with ${path}: no named test imports it at ${short(report.head)}.`);
  const words = conditionWords(report.conditions);
  if (words.length > 0 || report.repeat > 1)
    lines.push(
      [
        words.length > 0 ? `Conditions on both sides: ${words.join(", ")}.` : "",
        report.repeat > 1
          ? `Repeat ${report.repeat}: red up to ${report.repeat} runs to its first failure, green ${report.repeat} runs.`
          : "",
      ]
        .filter((part) => part !== "")
        .join(" "),
    );
  if (report.dirty.length > 0)
    lines.push(
      `This proves the committed HEAD ${short(report.head)}, not the uncommitted change to ${listed(report.dirty)}.`,
    );
  for (const file of report.files) {
    const why = file.reason === null ? "" : ` (${file.reason})`;
    lines.push(`${file.ref.path}: ${file.verdict}${why}`);
    lines.push(`  red: ${endText(file.red)}`);
    for (const failure of failuresOf(file.red.end)) {
      lines.push(`  ${failure.test} [${failureKind(failure)}]`);
      lines.push(...errorLines(failure.errors).map((line) => `  ${line.replace(/^ {2}/, INDENT)}`));
    }
    const notRun = `not run (${file.greenNotRun ?? "not needed"})`;
    lines.push(...importLines(file, report));
    lines.push(`  green: ${file.green === null ? notRun : endText(file.green)}`);
    const control = controlLine(file, report.conditions);
    if (control !== null) lines.push(`  ${control}`);
  }
  const counts = countsOf(report.files);
  const parts = Object.entries(counts).map(([verdict, n]) => `${n} ${verdict}`);
  const used = `${(report.usedMs / 1000).toFixed(1)} s of the ${report.timeoutSeconds} s budget`;
  lines.push(`${parts.join(", ")}; ${report.runs} run${report.runs === 1 ? "" : "s"} (${used})`);
  if (report.rerun !== null)
    lines.push(`${report.notRun} not run (budget). A rerun that fits: ${report.rerun}`);
  if (report.withRerun !== null)
    lines.push(`Rerun with the changed helpers as test code: ${report.withRerun}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Row 023-21: an unchanged test's changed imports. A stopped file names
 * its source changes beside the helpers its reason names; a file that ran
 * with only source changes says what it compared as source, so a helper
 * Squeal took for source is never compared silently.
 */
function importLines(file: ProofFile, report: ProofReport): string[] {
  const imports = file.imports;
  if (imports === null || imports.sources.length === 0) return [];
  const sources = imports.sources.join(", ");
  const how =
    report.case === "source"
      ? "source changes the proof compares"
      : `source changes, at ${short(report.head)} on both sides`;
  if (stops(imports)) return [`  ${how}: ${sources}`];
  if (imports.testSide) return [];
  return [
    `  the test is unchanged since ${short(report.base)}; ${how}: ${sources} (if one is test code, rerun with --with <path>)`,
  ];
}

/**
 * Row 023-20 (P9): the control run's one line under a condition: `red
 * only under the conditions` or `red without them too`, with how the run
 * without them ended; why it did not run; `null` with no condition.
 */
function controlLine(file: ProofFile, conditions: Conditions): string | null {
  if (!hasConditions(conditions)) return null;
  if (file.control === null)
    return `without the conditions: not run (${file.controlNotRun ?? "not needed"})`;
  const reading = controlReading(file.control.end);
  const how = `without them: ${endText(file.control)}`;
  return reading === "not known"
    ? `without the conditions: ${endText(file.control)}; not known whether red needs the conditions`
    : `${reading} (${how})`;
}

function countsOf(files: readonly ProofFile[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    proven: 0,
    "not red": 0,
    "red for another reason": 0,
    "not green": 0,
    "not comparable": 0,
  };
  for (const file of files) counts[file.verdict]++;
  return counts;
}

/** D5.5's versioned JSON report. */
export const PROOF_REPORT_VERSION = "squeal-proof/1";

function sideJson(side: SideFile | null) {
  if (side === null) return null;
  const { end } = side;
  return {
    end: end.end,
    reason: end.end === "unknown" ? end.reason : null,
    from: side.from,
    stored: side.stored,
    notStored: side.notStored,
    runs: side.runs,
    failures: failuresOf(end).map((failure) => ({
      test: failure.test,
      kind: failureKind(failure),
      text: errorLines(failure.errors)
        .map((line) => line.replace(/^ {2}/, ""))
        .join("\n"),
      errors: failure.errors,
    })),
  };
}

export function jsonProof(report: ProofReport): string {
  const value = {
    version: PROOF_REPORT_VERSION,
    case: report.case,
    base: report.base,
    head: report.head,
    red: report.red === null ? null : { ...report.red, with: report.with },
    green: { ...report.green, with: report.with },
    withUnused: report.withUnused,
    withRerun: report.withRerun,
    dirty: report.dirty,
    timeoutSeconds: report.timeoutSeconds,
    usedMs: report.usedMs,
    runs: report.runs,
    conditions: {
      env: report.conditions.env,
      without: report.conditions.without.map((w) => ({ path: w.given, where: w.where })),
      homeKeep: report.conditions.keep.map((k) => k.given),
    },
    repeat: report.repeat,
    notRun: report.notRun,
    rerun: report.rerun,
    checkoutMs: report.checkoutMs,
    counts: countsOf(report.files),
    files: report.files.map((file) => ({
      project: file.ref.project,
      path: file.ref.path,
      verdict: file.verdict,
      reason: file.reason,
      red: sideJson(file.red),
      green: sideJson(file.green),
      greenNotRun: file.greenNotRun,
      control: sideJson(file.control),
      controlReading: file.control === null ? null : controlReading(file.control.end),
      controlNotRun: file.controlNotRun,
      changedImports:
        file.imports === null
          ? null
          : {
              helpers: file.imports.helpers,
              sources: file.imports.sources,
              stopped: stops(file.imports),
            },
    })),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
