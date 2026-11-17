import type { FailedTest } from "../core/code/gate/types.js";
import type { ProofCase, Side } from "../core/proof/sides.js";
import { failureKind, type SideEnd, type Verdict } from "../core/proof/verdict.js";
import { errorLines } from "../core/status/format-why-replaced.js";
import type { RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SideFile } from "./proof-side.js";

/*
 * Spec 023 D5.5 (row 023-08): the proof's report: per named test file its
 * verdict, both sides with where each came from, and the red side's failed
 * tests with their failure text as `squeal why` prints it; the commits,
 * the case and the run count, so an agent can paste it into a pull
 * request. The JSON is versioned as `status --at`'s is.
 */

export interface ProofFile {
  readonly ref: TestFileRef;
  readonly verdict: Verdict;
  readonly reason: string | null;
  readonly red: SideFile;
  /** `null` when the green side was not read: the red side already decided. */
  readonly green: SideFile | null;
}

export interface ProofReport {
  readonly case: ProofCase;
  readonly base: string;
  readonly head: string;
  readonly red: Side;
  readonly green: Side;
  /** Paths a named test loads that the working tree holds otherwise than `HEAD`. */
  readonly dirty: readonly RelativePath[];
  readonly timeoutSeconds: number;
  readonly usedMs: number;
  /** How many side runs of a file this call made. */
  readonly runs: number;
  readonly files: readonly ProofFile[];
}

const short = (sha: string) => sha.slice(0, 9);

/** A side in words: `the test at X over the code at Y`, or `X` when both are one commit. */
export function sideText(side: Side): string {
  return side.tests === side.code
    ? `the test and code at ${short(side.code)}`
    : `the test at ${short(side.tests)} over the code at ${short(side.code)}`;
}

const FROM_TEXT = {
  store: "stored result",
  daemon: "this worktree's daemon",
  run: "run by this command",
} as const;

function endText(side: SideFile): string {
  const { end } = side;
  const what =
    end.end === "unknown"
      ? `unknown (${end.reason})`
      : end.end === "prepare"
        ? "prepare failed"
        : end.end;
  const from = side.from === null ? "" : `, ${FROM_TEXT[side.from]}`;
  const stored =
    side.from !== "run" ? "" : side.stored ? ", stored" : `, not stored (${side.notStored ?? ""})`;
  return `${what}${from}${stored}`;
}

function failuresOf(end: SideEnd): readonly FailedTest[] {
  return end.end === "fail" ? end.failures : [];
}

const INDENT = "    ";

/** D5.5's text: a header, each file's verdict with both sides and the red side's failures, counts. */
export function formatProof(report: ProofReport): string {
  const lines = [
    `squeal proof (case ${report.case}): base ${short(report.base)}, HEAD ${short(report.head)}`,
    `Red: ${sideText(report.red)}. Green: ${sideText(report.green)}.`,
  ];
  if (report.dirty.length > 0)
    lines.push(
      `This proves the committed HEAD ${short(report.head)}, not the uncommitted change to ${report.dirty.join(", ")}.`,
    );
  for (const file of report.files) {
    const why = file.reason === null ? "" : ` (${file.reason})`;
    lines.push(`${file.ref.path}: ${file.verdict}${why}`);
    lines.push(`  red: ${endText(file.red)}`);
    for (const failure of failuresOf(file.red.end)) {
      lines.push(`  ${failure.test} [${failureKind(failure)}]`);
      lines.push(...errorLines(failure.errors).map((line) => `  ${line.replace(/^ {2}/, INDENT)}`));
    }
    lines.push(`  green: ${file.green === null ? "not read" : endText(file.green)}`);
  }
  const counts = countsOf(report.files);
  const parts = Object.entries(counts).map(([verdict, n]) => `${n} ${verdict}`);
  const used = `${(report.usedMs / 1000).toFixed(1)} s of the ${report.timeoutSeconds} s budget`;
  lines.push(`${parts.join(", ")}; ${report.runs} run${report.runs === 1 ? "" : "s"} (${used})`);
  return `${lines.join("\n")}\n`;
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
    red: report.red,
    green: report.green,
    dirty: report.dirty,
    timeoutSeconds: report.timeoutSeconds,
    usedMs: report.usedMs,
    runs: report.runs,
    counts: countsOf(report.files),
    files: report.files.map((file) => ({
      project: file.ref.project,
      path: file.ref.path,
      verdict: file.verdict,
      reason: file.reason,
      red: sideJson(file.red),
      green: sideJson(file.green),
    })),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}
