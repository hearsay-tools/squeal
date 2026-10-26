import type { LintFinding } from "../types/lint.js";
import { lineHash } from "./fingerprint.js";

/*
 * Spec 017 D2, D6: ESLint's report of one file as the store's findings. The
 * shapes are the parts of ESLint 9 and 10's `LintResult` and `LintMessage`
 * read here, so the core needs no ESLint to build them.
 */

/** The fields of ESLint's `LintMessage` a finding keeps. */
export interface EslintMessage {
  readonly ruleId: string | null;
  /** 1 a warning, 2 an error; a rule set `off` reports nothing. */
  readonly severity: 1 | 2;
  readonly message: string;
  /** Absent on a message that names no place in the file. */
  readonly line?: number;
  readonly column?: number;
}

/** The fields of ESLint's `LintResult` read here, as `eslint -f json` writes them. */
export interface EslintFileResult {
  readonly filePath: string;
  readonly messages: readonly EslintMessage[];
  /** The file's text; ESLint gives it only when it has messages. */
  readonly source?: string;
}

/**
 * The findings of one file's messages in ESLint's order. `text` is the
 * file's text that was linted, for each finding's line hash. A message
 * with no line, as ESLint's own warnings, takes line and column 0.
 */
export function eslintFindings(
  messages: readonly EslintMessage[],
  text: string,
): readonly LintFinding[] {
  const lines = text.split("\n");
  return messages.map((m) => ({
    rule: m.ruleId,
    message: m.message,
    severity: m.severity === 2 ? "error" : "warning",
    line: m.line ?? 0,
    column: m.column ?? 0,
    lineHash: lineHash(m.line === undefined ? "" : (lines[m.line - 1] ?? "")),
  }));
}
