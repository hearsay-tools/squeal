import { createHash } from "node:crypto";
import type { LintFinding, LintFingerprint } from "../types/lint.js";

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** Spec 017 D2: a line's text with every whitespace character removed, hashed, so a reindent keeps it. */
export function lineHash(line: string): string {
  return hash(line.replace(/\s+/g, ""));
}

/**
 * Row 017-22: the rules whose message template names a line of the file,
 * and that part of the template. A move of code changes the number and no
 * finding (lessons.md L5). Only a template's own words are read: a message
 * also holds the project's text, as a restricted import named `line 1`,
 * which is a finding of its own (review 0.1.391 B1).
 */
const LINE_TEMPLATES: ReadonlyMap<string, RegExp> = new Map([
  // eslint-plugin-react-hooks: "… of useCallback Hook (at line 136) change on every render."
  ["react-hooks/exhaustive-deps", /( Hook \(at line )\d+(\) change on every render)/],
]);

/**
 * Row 017-22: the message a finding is compared by. A listed rule's message
 * has the line its template names replaced by `N`; every other message is
 * returned as it is.
 */
export function findingMessage(finding: Pick<LintFinding, "rule" | "message">): string {
  const template = finding.rule === null ? undefined : LINE_TEMPLATES.get(finding.rule);
  return template === undefined ? finding.message : finding.message.replace(template, "$1N$2");
}

/**
 * Spec 017 D2: the failure fingerprint of a file's findings, the sorted
 * multiset of `rule|message` with no line and no column (016-33's a-set),
 * or `null` with no finding. Each pair is JSON, so a `|` in a message is
 * never a separator. The message is {@link findingMessage}'s, so a set with
 * no listed rule's line hashes as it did before row 017-22.
 */
export function lintFingerprint(findings: readonly LintFinding[]): LintFingerprint | null {
  if (findings.length === 0) return null;
  const pairs = findings.map((f) => JSON.stringify([f.rule, findingMessage(f)])).sort();
  return hash(`[${pairs.join(",")}]`);
}
