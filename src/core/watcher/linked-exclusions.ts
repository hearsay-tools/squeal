import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { hasGitEntry, isMissing } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { ignoredAsDirectories } from "./links.js";

/**
 * The directories among `dirs`, and below those kept, that a watch of a
 * linked directory's `target` leaves out: one that holds its own `.git`
 * entry, and one git would ignore under every link in `links` were the link a
 * directory. The second is asked as `link/dir/` through
 * `ignoredAsDirectories`, whose scratch tree copies each `.gitignore` above
 * the path, the target's own read through the link. Walked one level at a
 * time, one git call per level, never below a directory left out and never
 * through a link inside the target, which its watch does not follow either.
 *
 * Task 001-300 (`research/nested-worktree-watch.md` R3): the root's watch
 * leaves out what git ignores, and a linked target's watch now does too.
 */
export async function linkedExclusions(
  root: AbsolutePath,
  links: readonly RelativePath[],
  target: AbsolutePath,
  dirs: readonly AbsolutePath[] = [target],
): Promise<AbsolutePath[]> {
  const excluded: AbsolutePath[] = [];
  let level = [...dirs];
  while (level.length > 0) {
    const asked: AbsolutePath[] = [];
    for (const dir of level) {
      if (dir !== target && (await hasGitEntry(dir))) excluded.push(dir);
      else asked.push(dir);
    }
    const ignored = await ignoredUnderLinks(
      root,
      links,
      target,
      asked.filter((dir) => dir !== target),
    );
    const next: AbsolutePath[] = [];
    for (const dir of asked) {
      if (ignored.has(dir)) excluded.push(dir);
      else next.push(...(await subdirectories(dir)));
    }
    level = next;
  }
  return excluded.sort();
}

/** The directories among `dirs`, below `target`, that git ignores under every link. */
async function ignoredUnderLinks(
  root: AbsolutePath,
  links: readonly RelativePath[],
  target: AbsolutePath,
  dirs: readonly AbsolutePath[],
): Promise<Set<AbsolutePath>> {
  if (dirs.length === 0 || links.length === 0) return new Set();
  const below = dirs.map((dir) => relative(target, dir));
  const answered = await ignoredAsDirectories(
    root,
    links.flatMap((link) => below.map((rel) => `${link}/${rel}`)),
  );
  return new Set(dirs.filter((_, i) => links.every((link) => answered.has(`${link}/${below[i]}`))));
}

/** The directories directly in `dir`, `.git` and links left out; none when it is gone. */
async function subdirectories(dir: AbsolutePath): Promise<AbsolutePath[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return [];
    throw error;
  }
  return entries.filter((e) => e.isDirectory() && e.name !== ".git").map((e) => join(dir, e.name));
}
