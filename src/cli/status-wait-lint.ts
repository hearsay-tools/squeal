import { fromBase } from "../core/status/next-step-text.js";
import { plural } from "../core/text.js";
import type { NamedLint, NamedLintFile } from "../core/types/lint-delivery.js";

/*
 * Row 017-37 (gh-238, spec 017 D8): the named wait's lines for the lint of
 * its paths, apart from the repository's `Lint:` line: one line of counts,
 * then a line for each check with no clean verdict.
 */

/** The most checks with no clean verdict the lines list; the rest are counted. */
export const NAMED_LINT_LISTED = 10;

/**
 * `Lint of the named files: 3 checks, 2 linted, 1 with findings, 1 pending.`
 * and a line for each check that fails, waits or is unknown; none without
 * a lint read.
 */
export function namedLintLines(
  lint: NamedLint | undefined,
  command: string,
  base: string | undefined,
): string[] {
  if (lint === undefined) return [];
  const total = lint.files.length;
  const parts = [
    plural(total, "check"),
    `${lint.done} linted`,
    ...(lint.failing === 0 ? [] : [`${lint.failing} with findings`]),
    ...(lint.pending === 0 ? [] : [`${lint.pending} pending`]),
    ...(lint.unknown === 0 ? [] : [`${lint.unknown} unknown`]),
  ];
  const open = lint.files.filter((f) => f.outcome !== "pass");
  const more = open.length - NAMED_LINT_LISTED;
  return [
    `Lint of the named files: ${parts.join(", ")}${lint.failing === 0 ? "" : `; ${command} lint lists the findings`}.`,
    ...open.slice(0, NAMED_LINT_LISTED).map((f) => `  ${fileLine(f, base)}`),
    ...(more > 0 ? [`  and ${plural(more, "more check")} with no clean verdict`] : []),
  ];
}

function fileLine(file: NamedLintFile, base: string | undefined): string {
  const head = `${fromBase(base, file.path)} (${file.tool})`;
  if (file.outcome === "fail") {
    return `${head}: ${file.findings === undefined ? "fails" : plural(file.findings, "finding")}`;
  }
  return `${head}: ${file.outcome}: ${file.reason ?? "no reason recorded"}`;
}
