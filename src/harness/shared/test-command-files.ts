import { isAbsolute, relative, resolve } from "node:path";
import type { AbsolutePath, TestFileRef } from "../../core/types/index.js";
import { describing } from "../../runners/descriptions.js";
import type { TestCommand } from "./test-command.js";

/**
 * Spec 005 D8 step 2: the test files `command` would run, from Squeal's own
 * listing of the worktree (`listing`, every test file of every project), or
 * `null` when they cannot be resolved completely. The command runs from
 * `root`. `configured` names the projects squeal.config.json configures; the
 * listing's other projects are the fallback runner's (spec 003 D7).
 * `omitted` counts the test files the listing left out because Squeal does
 * not run them, `null` when the daemon recorded no count. How a command's
 * files resolve is its runner's (spec 016 D5).
 */
export function resolveTestFiles(
  command: TestCommand,
  listing: readonly TestFileRef[],
  root: AbsolutePath,
  configured: ReadonlySet<string>,
  omitted: number | null,
): readonly TestFileRef[] | null {
  return describing(command).files(command, {
    files: listing,
    root,
    configured,
    omitted,
    pathOf: (path) => worktreePath(root, path),
  });
}

/** `path` relative to `root` with `/` separators; `null` outside it. */
function worktreePath(root: AbsolutePath, path: string): string | null {
  const rel = relative(root, resolve(root, path));
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return null;
  return rel;
}
