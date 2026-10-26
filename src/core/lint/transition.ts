import type { LintChange, LintFinding } from "../types/lint.js";
import { lintFingerprint } from "./fingerprint.js";

/**
 * Why a file was linted again: an edit, or a config, plugin or ESLint
 * change, which records no transition per file and is told as one summary
 * line (D2's last row, D8).
 */
export type LintCause = "edit" | "config";

/**
 * Spec 017 D2: the transition of one file from the result it was last
 * judged on to its new one. `null` is no judged result: a file never linted
 * before, or one deleted or excluded after. An empty list is `pass`. The
 * result is `null` when nothing is recorded: a first `pass`, the same
 * fingerprint, or a config change.
 */
export function lintTransition(
  before: readonly LintFinding[] | null,
  after: readonly LintFinding[] | null,
  cause: LintCause = "edit",
): LintChange | null {
  if (cause === "config") return null;
  const was = before === null ? null : lintFingerprint(before);
  const is = after === null ? null : lintFingerprint(after);
  if (is !== null) {
    if (before === null) return { kind: "first-seen-fail", added: after ?? [], removed: [] };
    if (was === null) return { kind: "pass-to-fail", added: after ?? [], removed: [] };
    if (was === is) return null;
    return { kind: "fail-changed", ...matchFindings(before, after ?? []) };
  }
  if (was === null) return null;
  return { kind: after === null ? "removed" : "fail-to-pass", added: [], removed: before ?? [] };
}

/**
 * Spec 017 D2: the findings added and removed between two sets, as evidence
 * only. They are matched first on rule, message and line hash, then the
 * rest on rule and message alone, so a finding whose line text changed is
 * not named twice. With two equal findings it can name the wrong one; the
 * counts are right (`diagnostic-identity.md` Q3).
 */
export function matchFindings(
  before: readonly LintFinding[],
  after: readonly LintFinding[],
): Pick<LintChange, "added" | "removed"> {
  const exact = unmatched(before, after, (f) => [f.rule, f.message, f.lineHash]);
  return unmatched(exact.removed, exact.added, (f) => [f.rule, f.message]);
}

/** Pairs each of `after` with an equal one of `before` by `anchor`, in order; the rest of each side. */
function unmatched(
  before: readonly LintFinding[],
  after: readonly LintFinding[],
  anchor: (f: LintFinding) => readonly (string | null)[],
): Pick<LintChange, "added" | "removed"> {
  const left = new Map<string, LintFinding[]>();
  for (const f of before) {
    const key = JSON.stringify(anchor(f));
    left.set(key, [...(left.get(key) ?? []), f]);
  }
  const matched = new Set<LintFinding>();
  const added = after.filter((f) => {
    const twin = left.get(JSON.stringify(anchor(f)))?.shift();
    if (twin !== undefined) matched.add(twin);
    return twin === undefined;
  });
  return { added, removed: before.filter((f) => !matched.has(f)) };
}
