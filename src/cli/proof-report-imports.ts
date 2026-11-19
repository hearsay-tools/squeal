import type { ChangedImports } from "../core/proof/imports.js";
import type { ProofCase } from "../core/proof/sides.js";
import type { RelativePath } from "../core/types/common.js";

/*
 * Spec 023 D5.2 as amended 2026-11-19 (the human, "A: stop when unsure";
 * then "A: stop guessing"; row 023-21): the report's words for an
 * unchanged test's changed imports: per file, the ones neither flag
 * named and the ones `--source` named; per call, a warning per `--with`
 * or `--source` path that changes nothing, and the two reruns of a stop.
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

/** One file's lines: the changed imports neither flag named, then those `--source` named. */
export function importLines(imports: ChangedImports | null, report: ImportsReport): string[] {
  if (imports === null) return [];
  const read = new Set(imports.read);
  const each = imports.unsettled.map((path) =>
    read.has(path) ? `${path} (the test read it)` : path,
  );
  const lines =
    each.length === 0
      ? []
      : [`  changed files neither --with nor --source names: ${each.join(", ")}`];
  if (imports.sources.length === 0) return lines;
  const how =
    report.case === "source"
      ? "product code by --source, compared"
      : `product code by --source, at ${short(report.head)} on both sides`;
  return [...lines, `  ${how}: ${imports.sources.join(", ")}`];
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
        `Warning: --source ${path}: not a changed file between ${short(report.base)} and HEAD; it settles nothing.`,
    ),
  ];
}

/** A stop's two reruns, after the counts, and that the agent may mix the flags per file. */
export function rerunLines(report: ImportsReport): string[] {
  if (report.withRerun === null || report.sourceRerun === null) return [];
  return [
    `Squeal does not tell test code from product code. If they are product code, rerun: ${report.sourceRerun}`,
    `If they are test code, rerun: ${report.withRerun}`,
    "Or name each file with --source (product code, taken from each side's code version) or --with (test code, copied from the test version).",
  ];
}
