import { type ChangedImports, stops } from "../core/proof/imports.js";
import type { ProofCase } from "../core/proof/sides.js";
import type { RelativePath } from "../core/types/common.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop when unsure";
 * row 023-21): the report's words for an unchanged test's changed
 * imports: per file, what was not settled and why, and what was compared
 * as product code and why; per call, a warning per `--with` or `--source`
 * path that changes nothing, and the two reruns of a stop.
 */

const short = (sha: string) => sha.slice(0, 9);

export interface ImportsReport {
  readonly case: ProofCase | null;
  readonly base: string;
  readonly head: string;
  readonly source: readonly RelativePath[];
  readonly withUnused: readonly RelativePath[];
  readonly sourceUnused: readonly RelativePath[];
  readonly withRerun: string | null;
  readonly sourceRerun: string | null;
}

/** One file's lines: the unsettled imports with why, then the product code it compares. */
export function importLines(imports: ChangedImports | null, report: ImportsReport): string[] {
  if (imports === null) return [];
  const lines = imports.unsettled.map(
    (u) =>
      `  not settled: ${u.path} (${u.testCode ? `test code: ${u.why}` : `could not tell whether it is test or product code: ${u.why}`})`,
  );
  if (imports.sources.length === 0) return lines;
  const sources = imports.sources.map((s) => `${s.path} (${s.why})`).join(", ");
  const how =
    report.case === "source"
      ? "product code the proof compares"
      : `product code, at ${short(report.head)} on both sides`;
  if (stops(imports)) return [...lines, `  ${how}: ${sources}`];
  if (imports.testSide) return [];
  return [`  the test is unchanged since ${short(report.base)}; ${how}: ${sources}`];
}

/**
 * The call's own lines: the `--source` paths, then a warning per `--with`
 * path no named test imports and per `--source` path that settles nothing.
 */
export function callLines(report: ImportsReport): string[] {
  return [
    ...(report.source.length === 0
      ? []
      : [`Product code by --source, compared as source: ${report.source.join(", ")}.`]),
    ...report.withUnused.map(
      (path) => `Warning: --with ${path}: no named test imports it at ${short(report.head)}.`,
    ),
    ...report.sourceUnused.map(
      (path) =>
        `Warning: --source ${path}: not a changed import of an unchanged named test; it settles nothing.`,
    ),
  ];
}

/** A stop's two reruns, after the counts. */
export function rerunLines(report: ImportsReport): string[] {
  return [
    ...(report.withRerun === null
      ? []
      : [`If the changed imports are test code, rerun: ${report.withRerun}`]),
    ...(report.sourceRerun === null
      ? []
      : [`If the ones not shown to be test code are product code, rerun: ${report.sourceRerun}`]),
  ];
}
