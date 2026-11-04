import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent, runGit } from "../fs/index.js";
import type { AbsolutePath, FileHash, RelativePath } from "../types/index.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/**
 * Row 019-37 (lessons P11): the blob git would store for the working-tree
 * file at each of `paths`, with the path's attributes and `core.autocrlf`
 * applied (`eol`, `text`, `filter`, `ident`): one `git hash-object
 * --stdin-paths`. The stat cache hashes the bytes on disk (spec 001 D3), and
 * for a file git converts these are not the blob a commit holds, though git
 * reads the file as unchanged: cezarion's `gradlew.bat` (`eol=crlf`) is
 * CRLF on disk and LF in each commit.
 *
 * Only regular files are asked: git follows a symlink. A path git cannot
 * take on a stdin line (a newline, a leading quote), one that is no regular
 * file, and every path when git fails (a file gone meanwhile) are left out.
 */
export async function storedBlobs(
  root: AbsolutePath,
  paths: readonly RelativePath[],
): Promise<Map<RelativePath, FileHash>> {
  const lines = paths.filter((path) => !path.includes("\n") && !path.startsWith('"'));
  const regular = await mapConcurrent(lines, (path) => isRegularFile(join(root, path)));
  const files = lines.filter((_, i) => regular[i]);
  if (files.length === 0) return new Map();
  try {
    const out = await runGit(root, ["hash-object", "--stdin-paths"], {
      input: `${files.join("\n")}\n`,
      timeoutMs: LS_TREE_TIMEOUT_MS,
    });
    const hashes = out.split("\n").filter((line) => line !== "");
    if (hashes.length !== files.length) return new Map();
    return new Map(files.map((path, i) => [path, hashes[i] as FileHash]));
  } catch {
    return new Map();
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  return lstat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
}
