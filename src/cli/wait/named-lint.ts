import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { namedLintOf, namedLintWaits } from "../../core/lint/surface/named.js";
import { lintStoreSource } from "../../core/lint/surface/source.js";
import type { AbsolutePath, EpochMs, RelativePath } from "../../core/types/common.js";
import type { NamedLint } from "../../core/types/lint-delivery.js";
import { folderPath, worktreePath } from "../named-selection.js";
import { readBound } from "./presence.js";
import type { Decided } from "./status-table.js";

/*
 * Row 017-37 (gh-238): the named wait's read of the lint of its paths
 * (`namedLintOf`). A named file picks its own checks, a named folder those
 * of every file below it. Lint off, a store not made yet, unreadable or
 * busy reads as no lint: a wait never holds on a lint it cannot read.
 */

/** Which worktree paths the named paths pick, resolved once per wait. */
export function namedPicker(
  root: AbsolutePath,
  cwd: AbsolutePath,
  paths: readonly string[],
): (path: RelativePath) => boolean {
  const files = new Set<string>();
  const folders: string[] = [];
  for (const path of paths) {
    const folder = folderPath(root, cwd, path);
    if (folder !== null) folders.push(folder === "" ? "" : `${folder}/`);
    else {
      const file = worktreePath(root, cwd, path);
      if (file !== null) files.add(file);
    }
  }
  return (path) => files.has(path) || folders.some((f) => path.startsWith(f));
}

/** One read of the named paths' lint; `null` when there is none to read. */
export function readNamedLint(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  named: (path: RelativePath) => boolean,
  now: EpochMs,
  busyTimeoutMs: number,
): NamedLint | null {
  let access: ReturnType<ReturnType<typeof lintStoreSource>["open"]> = null;
  try {
    access = lintStoreSource(commonDir, root, { busyTimeoutMs }).open();
    if (access === null || access === "missing" || "unreadable" in access) return null;
    return namedLintOf(access.store, worktreeIdFor(root), named, now);
  } catch {
    return null;
  } finally {
    if (access !== null && access !== "missing" && "store" in access) access.store.close();
  }
}

/** A wait's reads of its paths' lint, the picker resolved at the first, each in the wait's busy bound. */
export function namedLintReads(
  cwd: AbsolutePath,
  paths: readonly string[],
  deadline: number,
  now: () => EpochMs,
): (root: AbsolutePath, commonDir: AbsolutePath) => NamedLint | null {
  let named: ((path: RelativePath) => boolean) | undefined;
  return (root, commonDir) => {
    named ??= namedPicker(root, cwd, paths);
    return readNamedLint(root, commonDir, named, now(), readBound(deadline, now).busyTimeoutMs);
  };
}

/**
 * Row 017-37: a read the test files decided waits on while the pass lints a
 * named path (`namedLintWaits`), with the daemon alive and before the
 * deadline. A `--check` wait's focused answer is left as it was. At the
 * deadline the test files decide alone; the lint read tells where it stood.
 */
export function lintDecided(
  tested: Decided | null,
  final: boolean,
  alive: boolean,
  read: () => NamedLint | null,
): { readonly decided: Decided | null; readonly lint: NamedLint | null | undefined } {
  if (tested === null || tested === "focused" || final || !alive) {
    return { decided: tested, lint: undefined };
  }
  const lint = read();
  return { decided: namedLintWaits(lint) > 0 ? null : tested, lint };
}

/** The end's `lint` field: the read a decision made, else one now; none when there is no lint. */
export function lintField(
  lint: NamedLint | null | undefined,
  read: () => NamedLint | null,
): { readonly lint?: NamedLint } {
  const last = lint === undefined ? read() : lint;
  return last === null ? {} : { lint: last };
}
