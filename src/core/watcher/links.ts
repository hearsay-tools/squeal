import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMissing, runGit, splitNul, toAbsolute } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { selfAndAncestors } from "./paths.js";

/** Caches "is this directory a symlink" for one batch. */
export class SymlinkProbe {
  private readonly cache = new Map<RelativePath, Promise<boolean>>();

  constructor(private readonly root: AbsolutePath) {}

  /** The outermost directory above `path`, below the root, that is a symlink; `null` when none is. */
  async linkAbove(path: RelativePath): Promise<RelativePath | null> {
    const dirs = [...selfAndAncestors(path)].slice(1);
    for (const dir of dirs.reverse()) {
      let hit = this.cache.get(dir);
      if (!hit) {
        hit = isSymlink(toAbsolute(this.root, dir));
        this.cache.set(dir, hit);
      }
      if (await hit) return dir;
    }
    return null;
  }
}

async function isSymlink(abs: AbsolutePath): Promise<boolean> {
  try {
    return (await lstat(abs)).isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** True when `abs` is a symlink whose target is a directory. */
export async function isLinkedDir(abs: AbsolutePath): Promise<boolean> {
  try {
    return (await lstat(abs)).isSymbolicLink() && (await stat(abs)).isDirectory();
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ELOOP") return false;
    throw error;
  }
}

/**
 * Among `links`, symlinks below the root that git does not ignore by their own
 * path, the ones git would ignore if a directory stood at that path. Git sees a
 * link as a file, so a directory-only pattern (`node_modules/`) never matches
 * it, and it refuses `L/` as beyond a symbolic link. One `check-ignore
 * --no-index` against a scratch work tree answers instead: it holds a copy of
 * every `.gitignore` above each link and nothing else, so `L/` names a missing
 * directory, which git matches as one. The git directory is the worktree's, so
 * `info/exclude` and `core.excludesFile` apply as they do to the worktree.
 *
 * The scratch tree lives under the process's temp directory, which in the
 * daemon is its own (spec 001 D10), never inside the worktree, and is reused,
 * one call at a time per root.
 */
export function ignoredAsDirectories(
  root: AbsolutePath,
  links: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  if (links.length === 0) return Promise.resolve(new Set());
  const scratch = join(tmpdir(), `squeal-links-${hashOf(root)}`);
  const previous = scratchQueue.get(scratch) ?? Promise.resolve();
  const run = previous.then(() => askAsDirectories(root, scratch, links));
  const settled = run.then(
    () => {},
    () => {},
  );
  scratchQueue.set(scratch, settled);
  void settled.then(() => {
    if (scratchQueue.get(scratch) === settled) scratchQueue.delete(scratch);
  });
  return run;
}

const scratchQueue = new Map<string, Promise<void>>();

async function askAsDirectories(
  root: AbsolutePath,
  scratch: AbsolutePath,
  links: readonly RelativePath[],
): Promise<Set<RelativePath>> {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const dirs = new Set<RelativePath>([""]);
  for (const link of links) {
    for (const dir of [...selfAndAncestors(link)].slice(1)) dirs.add(dir);
  }
  for (const dir of dirs) {
    await mkdir(join(scratch, dir), { recursive: true });
    try {
      await copyFile(join(root, dir, ".gitignore"), join(scratch, dir, ".gitignore"));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const gitDir = await gitDirOf(root);
  const out = await runGit(
    scratch,
    [
      `--git-dir=${gitDir}`,
      `--work-tree=${scratch}`,
      "check-ignore",
      "--no-index",
      "-z",
      "--stdin",
    ],
    // Exit 1 means none is ignored.
    { input: links.map((link) => `${link}/\0`).join(""), okCodes: [0, 1] },
  );
  return new Set(splitNul(out).map((path) => path.replace(/\/$/, "")));
}

const gitDirs = new Map<AbsolutePath, Promise<string>>();

/** The worktree's git directory, asked once per root. */
function gitDirOf(root: AbsolutePath): Promise<string> {
  let dir = gitDirs.get(root);
  if (!dir) {
    dir = runGit(root, ["rev-parse", "--absolute-git-dir"]).then((out) => out.trim());
    dir.catch(() => gitDirs.delete(root));
    gitDirs.set(root, dir);
  }
  return dir;
}

function hashOf(root: AbsolutePath): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}
