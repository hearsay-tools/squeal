import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodeStore } from "../../../src/core/code/store/types.js";
import { recountKey } from "../../../src/core/delivery/code-deliver.js";
import { type CodeSource, codeSource } from "../../../src/core/delivery/code-source.js";
import type {
  CodeCheckId,
  CodeKnownState,
  CodeTransition,
  CodeTransitionKind,
  FunctionCount,
} from "../../../src/core/types/code.js";
import type { CodeRecount } from "../../../src/core/types/code-delivery.js";
import { commonDir, open } from "../helpers.js";

/*
 * Code store rows seeded the way the daemon's pass (015-06) writes them, so
 * delivery, status and `squeal code` read them without a counter.
 */

export const TIERS = "src/core/scheduler/tiers.ts";

/** A repository with a code store and a worktree root whose policy turns complexity on. */
export interface CodeRepo {
  readonly dir: string;
  readonly root: string;
  /** The writer's connection, as the daemon's. */
  readonly store: CodeStore;
  readonly source: CodeSource;
}

/** Writes `squeal.config.json` at the worktree root. */
export function writePolicy(root: string, complexity: Record<string, unknown>): void {
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ complexity }));
}

export function codeRepo(complexity: Record<string, unknown> = { enabled: true }): CodeRepo {
  const dir = commonDir();
  const root = dirname(dir);
  writePolicy(root, complexity);
  return { dir, root, store: open(dir), source: codeSource(dir, root) };
}

export function fnCheck(qualifiedName: string, path = TIERS, occurrence = 0): CodeCheckId {
  return { kind: "code", path, qualifiedName, occurrence };
}

/** One counted function at `line` with complexity `cc`, all of it `if`s. */
export function fn(qualifiedName: string, cc: number, line: number, occurrence = 0): FunctionCount {
  return {
    qualifiedName,
    occurrence,
    range: { startLine: line, startColumn: 1, endLine: line + 10, endColumn: 2 },
    bodyHash: `${qualifiedName}-${cc}`,
    complexity: cc,
    decisions: cc > 1 ? { if: cc - 1 } : {},
  };
}

/** Stores the file at `path` in `worktreeId` with these functions counted, at `revision`. */
export function putFile(
  store: CodeStore,
  worktreeId: string,
  path: string,
  functions: readonly FunctionCount[],
  {
    revision = 1,
    // A count is kept per blob: other functions are other bytes.
    blob = `${path}@${functions.map((f) => `${f.qualifiedName}=${f.complexity}`).join(",")}`,
  }: { revision?: number; blob?: string } = {},
): void {
  store.files.upsertMany(worktreeId, [
    { path, blob, language: "typescript", counterVersion: 1, size: 2_000, revision },
  ]);
  store.counts.put(
    { blob, language: "typescript", counterVersion: 1, functions, errors: [] },
    1_000,
  );
}

/** The complexity state of `check` at `cc` against `threshold`. */
export function codeState(
  worktreeId: string,
  check: CodeCheckId,
  cc: number,
  { threshold = 20, revision = 1 }: { threshold?: number; revision?: number } = {},
): CodeKnownState {
  return {
    worktreeId,
    check,
    measure: "complexity",
    outcome: cc > threshold ? "fail" : "pass",
    value: cc,
    threshold,
    countedAt: revision,
    blob: `blob-${check.path}`,
    changedAt: revision,
  };
}

/** A recorded complexity transition of `check`. */
export function codeTransition(
  worktreeId: string,
  check: CodeCheckId,
  kind: CodeTransitionKind,
  {
    from,
    to,
    at,
    revision = 2,
  }: { from: number | null; to: number | null; at: number; revision?: number },
): CodeTransition {
  return {
    worktreeId,
    check,
    measure: "complexity",
    kind,
    from: from === null ? null : from > 20 ? "fail" : "pass",
    to: to === null ? null : to > 20 ? "fail" : "pass",
    fromValue: from,
    toValue: to,
    threshold: 20,
    revision,
    at,
  };
}

/** Records `recount` as the daemon's pass writes it (015-06). */
export function putRecount(store: CodeStore, worktreeId: string, recount: CodeRecount): void {
  store.meta.set(recountKey(worktreeId), JSON.stringify(recount));
}
