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
 * Spec 017 D2: the failure fingerprint of a file's findings, the sorted
 * multiset of `rule|message` with no line and no column (016-33's a-set),
 * or `null` with no finding. Each pair is JSON, so a `|` in a message is
 * never a separator.
 */
export function lintFingerprint(findings: readonly LintFinding[]): LintFingerprint | null {
  if (findings.length === 0) return null;
  const pairs = findings.map((f) => JSON.stringify([f.rule, f.message])).sort();
  return hash(`[${pairs.join(",")}]`);
}
