import type { RelativePath } from "../../../types/common.js";
import { type EslintMessage, eslintFindings } from "../../eslint.js";
import type { LintFileResult } from "../../pass/provider.js";

/*
 * Spec 017 D11 "Output": oxlint's `--format json` report as the store's
 * findings (`research/oxlint-provider.md` Q4). `code` (`plugin(rule)`) is the
 * rule, absent on a parse error; `labels[0].span` gives a 1-based line and a
 * 1-based column in UTF-8 bytes, which becomes ESLint's UTF-16 column.
 */

/** The fields of one diagnostic read here, as oxlint 1.65 to 1.90 print them. */
export interface OxlintDiagnostic {
  readonly message: string;
  readonly code?: string | undefined;
  readonly severity: string;
  readonly filename: string;
  readonly labels?: readonly {
    readonly span: { readonly line: number; readonly column: number };
  }[];
}

/** The report's fields read here. */
export interface OxlintReport {
  readonly diagnostics: readonly OxlintDiagnostic[];
  /** The named files oxlint linted: an ignored or missing one is not counted. */
  readonly number_of_files: number;
}

/** A run's stdout: the JSON report, or the first line of the text it printed instead (D9). */
export type ParsedRun = { readonly report: OxlintReport } | { readonly text: string };

const PLUGIN_ERROR = "Error running JS plugin.";

export function parseRun(stdout: string): ParsedRun {
  try {
    const report: unknown = JSON.parse(stdout);
    if (isReport(report)) return { report };
  } catch {
    // Text: a config that does not load, a missing tool, "No files found to lint".
  }
  return { text: stdout.trimStart().split("\n")[0]?.trimEnd() ?? "" };
}

function isReport(value: unknown): value is OxlintReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<OxlintReport>;
  return Array.isArray(report.diagnostics) && typeof report.number_of_files === "number";
}

/**
 * Each asked file's result, from the run's diagnostics. A diagnostic of
 * another file is dropped, among them the suppressions file's own finding,
 * whose `filename` is empty. A JS plugin's error makes its file `unknown`.
 */
export function fileResults(
  diagnostics: readonly OxlintDiagnostic[],
  texts: ReadonlyMap<RelativePath, string>,
): Map<RelativePath, LintFileResult> {
  const byFile = new Map<RelativePath, OxlintDiagnostic[]>();
  for (const d of diagnostics) {
    const path = d.filename as RelativePath;
    if (!texts.has(path)) continue;
    const list = byFile.get(path) ?? [];
    if (list.length === 0) byFile.set(path, list);
    list.push(d);
  }
  const results = new Map<RelativePath, LintFileResult>();
  for (const [path, text] of texts) {
    const list = byFile.get(path) ?? [];
    const failed = list.find((d) => d.code === undefined && d.message.startsWith(PLUGIN_ERROR));
    if (failed !== undefined) {
      results.set(path, { unknown: `a JS plugin failed: ${pluginError(failed.message)}` });
      continue;
    }
    const lines = text.split("\n");
    const messages = list.map((d) => eslintMessage(d, lines));
    messages.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
    results.set(path, { findings: eslintFindings(messages, text) });
  }
  return results;
}

function eslintMessage(d: OxlintDiagnostic, lines: readonly string[]): EslintMessage {
  const span = d.labels?.[0]?.span;
  const base = {
    ruleId: d.code ?? null,
    severity: d.severity === "error" ? 2 : 1,
    message: d.message,
  };
  if (span === undefined) return base as EslintMessage;
  const column = utf16Column(lines[span.line - 1] ?? "", span.column);
  return { ...base, line: span.line, column } as EslintMessage;
}

/** The plugin's own error line: `Error: rule exploded`, or the message's first line after the first. */
function pluginError(message: string): string {
  const lines = message.split("\n").slice(1);
  return (lines.find((l) => /^\w*Error\b/.test(l)) ?? lines[0] ?? message).trim();
}

/**
 * ESLint's 1-based UTF-16 column of oxlint's 1-based UTF-8 byte column in
 * `line`. A column past the line's end, which no finding should have, is
 * kept as given.
 */
export function utf16Column(line: string, byteColumn: number): number {
  const bytes = Buffer.from(line, "utf8");
  if (byteColumn < 1 || byteColumn - 1 > bytes.length) return byteColumn;
  return bytes.subarray(0, byteColumn - 1).toString("utf8").length + 1;
}
