import { codeSince, type ShellSession } from "../delivery/code-since.js";
import { lintStatusLines } from "../lint/surface/format.js";
import { lintStatus } from "../lint/surface/report.js";
import { lintStoreSource } from "../lint/surface/source.js";
import type { AbsolutePath, StatusSnapshot, Store, WorktreeId } from "../types/index.js";
import type { LintStatus } from "../types/lint-delivery.js";

/*
 * Spec 017 D8: status's lint line and its `lint` JSON, read from the lint
 * store with no daemon (011 C6), "since this session started" as 015's code
 * counts it. Absent while `lint.enabled` is off, so status is then the one
 * before (goal 1).
 */

/** `StatusSnapshot.lint` of the worktree, or nothing while the policy is off. */
export function lintStatusOf(
  store: Store,
  worktreeId: WorktreeId,
  at: { readonly root: AbsolutePath; readonly commonDir: () => AbsolutePath | null },
  shell: ShellSession | null,
): { lint?: LintStatus } {
  const commonDir = at.commonDir();
  if (commonDir === null) return {};
  const source = lintStoreSource(commonDir, at.root);
  if (source.policy() === null) return {};
  const lint = lintStatus(source, worktreeId, codeSince(store, worktreeId, shell));
  return lint === undefined ? {} : { lint };
}

/** D8: the lint lines under the code lines; none while lint is off. */
export const lintStatusPart = (s: StatusSnapshot, command: string): string[] =>
  s.lint === undefined ? [] : lintStatusLines(s.lint, command);
