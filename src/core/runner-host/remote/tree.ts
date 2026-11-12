import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AbsolutePath } from "../../types/common.js";
import { insideRoot, packFiles, type TreeEntry, type TreeWrite, treeBlob } from "./tree-wire.js";

/*
 * Spec 021 D10 (row 021-13): the daemon's side of the remote tree. The tree
 * is every tracked file and every untracked one Git does not ignore, never
 * an ignored one (`remote-execution.md` Q3: a sync tool copied a
 * git-ignored `.env`). Git's own listing decides, so the remote holds what
 * a clone with the worktree's edits would.
 */

const run = promisify(execFile);

/** What one `write` message carries at most, in bytes before base64. */
export const WRITE_BYTES = 8 * 1024 * 1024;

/** The paths of `root`'s tree: tracked, and untracked but not ignored, each once, sorted. */
export async function treePaths(root: AbsolutePath): Promise<string[]> {
  const { stdout } = await run(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  const paths = new Set(stdout.split("\0").filter((path) => path !== "" && insideRoot(path)));
  return [...paths].sort();
}

/** A file of the tree as it is on disk now, with its bytes; `null` when it is no file or link. */
export async function readEntry(
  root: AbsolutePath,
  path: string,
): Promise<{ entry: TreeEntry; bytes: Buffer } | null> {
  const at = join(root, path);
  try {
    const stat = await lstat(at);
    if (stat.isSymbolicLink()) {
      const bytes = Buffer.from(await readlink(at), "utf8");
      return { entry: { path, blob: treeBlob(bytes), mode: "link" }, bytes };
    }
    if (!stat.isFile()) return null;
    const bytes = await readFile(at);
    const x = (stat.mode & 0o111) !== 0;
    return { entry: { path, blob: treeBlob(bytes), ...(x ? { mode: "x" as const } : {}) }, bytes };
  } catch {
    // Gone since the listing, or unreadable: not part of the tree now.
    return null;
  }
}

/** The tree's entries, each read now. */
export async function treeEntries(root: AbsolutePath): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  for (const path of await treePaths(root)) {
    const read = await readEntry(root, path);
    if (read !== null) entries.push(read.entry);
  }
  return entries;
}

/**
 * The writes that bring a remote to `paths` as they are on disk now: a path
 * of the tree with its bytes, a path that is no longer in it (deleted, or
 * ignored now) removed. Split so that no message carries much more than
 * `WRITE_BYTES` before compression; a larger file goes alone.
 */
export async function writesFor(
  root: AbsolutePath,
  paths: readonly string[],
  tree: ReadonlySet<string>,
  limit: number = WRITE_BYTES,
): Promise<TreeWrite[]> {
  const writes: TreeWrite[] = [];
  let files: { entry: TreeEntry; bytes: Buffer }[] = [];
  let removed: string[] = [];
  let size = 0;
  const flush = async () => {
    if (files.length > 0 || removed.length > 0)
      writes.push({ ...(await packFiles(files)), removed });
    files = [];
    removed = [];
    size = 0;
  };
  for (const path of [...new Set(paths)].sort()) {
    if (!insideRoot(path)) continue;
    const read = tree.has(path) ? await readEntry(root, path) : null;
    if (read === null) {
      removed.push(path);
      continue;
    }
    if (size > 0 && size + read.bytes.byteLength > limit) await flush();
    files.push(read);
    size += read.bytes.byteLength;
  }
  await flush();
  return writes;
}
