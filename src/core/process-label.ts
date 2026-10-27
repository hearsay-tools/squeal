import { realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, resolve } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "./fs/git-layout.js";
import type { AbsolutePath } from "./types/index.js";

/*
 * Spec 005 D3, project-first process commands (row 005-88): the argv0 Squeal
 * gives the Node processes it starts on Linux, so a process monitor's command
 * column shows the project and role before the long runtime paths. Display
 * only: the executable and every argument after argv0 stay as they were, and
 * discovery and retention read those arguments, never the label.
 */

/** The roles of a worktree's labelled processes. */
export type WorktreeRole = "daemon" | "node-test";

/** A project component's cap, so a long name cannot hide the role. */
export const PROJECT_MAX = 32;

/** Node's lookup when a child's environment has no `PATH` (`child_process.spawn`). */
const DEFAULT_PATH = "/usr/bin:/bin";

/**
 * The spawn option for `label`: the label on Linux; `undefined` elsewhere and
 * for no label, so argv0 stays the executable.
 */
export function argv0For(
  label: string | null,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return label !== null && platform === "linux" ? label : undefined;
}

/**
 * `squeal <project> <role> @<id8>` for the worktree at `root` whose common
 * directory is `commonDir`. `id` is its `worktreeIdFor`, whose first eight
 * characters tell worktrees apart on screen and identify nothing; `null`
 * omits the suffix.
 */
export function worktreeLabel(
  role: WorktreeRole,
  root: AbsolutePath,
  commonDir: AbsolutePath | null,
  id: string | null,
): string {
  const project = projectComponent(projectOf(commonDir) ?? basename(root));
  return id === null ? `squeal ${project} ${role}` : `squeal ${project} ${role} @${id.slice(0, 8)}`;
}

/** `squeal <project> check`, for the integrity check of the store under `commonDir`. */
export function storeCheckLabel(commonDir: AbsolutePath): string {
  return `squeal ${projectComponent(projectOf(commonDir) ?? "store")} check`;
}

/** `worktreeIdFor(root)`; `null` when `root` cannot be read, which omits the suffix. */
export function displayId(root: AbsolutePath): string | null {
  try {
    return worktreeIdFor(root);
  } catch {
    return null;
  }
}

/**
 * The project a conventional `<project>/.git` common directory names; `null`
 * for any other layout (a bare or separate git dir, a submodule), whose
 * directory name is no project name.
 */
function projectOf(commonDir: AbsolutePath | null): string | null {
  return commonDir !== null && basename(commonDir) === ".git" ? basename(dirname(commonDir)) : null;
}

/**
 * A project name safe to print: each run of characters other than ASCII
 * letters, digits, `.`, `_` and `-` becomes `-`, edge hyphens go, then at
 * most `PROJECT_MAX` characters without a hyphen left at the cut; `project`
 * when nothing is left.
 */
export function projectComponent(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, PROJECT_MAX).replace(/-+$/, "") || "project";
}

/**
 * The argv0 of a `role` process of the worktree at `root` that spawns
 * `command` from `cwd` under `env`: its label only when `command` resolves as
 * spawn finds it (a path against `cwd`, a name on `env.PATH`) to the file this
 * process runs, `process.execPath`. A version manager's shim (Volta, mise)
 * picks its tool by argv0, so any other executable, and one that cannot be
 * read, keeps its own argv0 (D3 as amended for row 005-88).
 */
export function ownNodeArgv0(
  role: WorktreeRole,
  root: AbsolutePath,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  let label: string | null = null;
  try {
    const dirs = command.includes("/") ? [""] : (env.PATH ?? DEFAULT_PATH).split(delimiter);
    const found = dirs.map((dir) => resolve(cwd, dir, command)).find(executableFile);
    const own = found !== undefined && realpathSync(found) === realpathSync(process.execPath);
    label = own ? worktreeLabel(role, root, resolveCommonDir(root), worktreeIdFor(root)) : null;
  } catch {
    // An executable or a layout it cannot read: argv0 stays the command.
  }
  return argv0For(label);
}

/** Whether `path` is a file with an execute bit, as an exec lookup would take it. */
function executableFile(path: string): boolean {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat?.isFile() === true && (stat.mode & 0o111) !== 0;
}
