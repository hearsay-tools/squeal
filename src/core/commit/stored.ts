import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { mapConcurrent, runGit } from "../fs/index.js";
import { blobHash } from "../hash/blob.js";
import { isRacy, sameStat } from "../hash/stat-cache.js";
import type { AbsolutePath, FileHash, FileStat, RelativePath } from "../types/index.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/**
 * Row 019-37 (lessons P11): the blob git would store for the bytes each
 * key was made of, given by their hash in `hashes`, with the path's
 * attributes and `core.autocrlf` applied (`eol`, `text`, `filter`,
 * `ident`). The stat cache hashes the bytes on disk (spec 001 D3), and for
 * a file git converts these are not the blob a commit holds, though git
 * reads the file as unchanged: cezarion's `gradlew.bat` (`eol=crlf`) is
 * CRLF on disk and LF in each commit.
 *
 * Review 0.1.401 B1: only those bytes count, never the file as it is now.
 * Each file is read once and must hash to its cached hash; git then hashes
 * the files in one `git hash-object --stdin-paths`; a file whose stat moved
 * across git's read, or that was written within the racy window before it
 * was read (`isRacy`, the stat cache's own rule), is left out, so a file
 * restored or edited since its key was made stays a difference. A path
 * that is no regular file (git follows a symlink), or that git cannot take
 * on a stdin line (a newline, a leading quote), is left out; on a git error
 * every path is. Git is asked nothing when no file is left to ask.
 */
export async function storedBlobs(
  root: AbsolutePath,
  hashes: ReadonlyMap<RelativePath, FileHash>,
): Promise<Map<RelativePath, FileHash>> {
  const read = await mapConcurrent([...hashes], ([path, cached]) => keyRead(root, path, cached));
  const files = read.flatMap((file) => (file === null ? [] : [file]));
  if (files.length === 0) return new Map();
  let out: string;
  try {
    out = await runGit(root, ["hash-object", "--stdin-paths"], {
      input: `${files.map((file) => file.path).join("\n")}\n`,
      timeoutMs: LS_TREE_TIMEOUT_MS,
    });
  } catch {
    return new Map();
  }
  const blobs = out.split("\n").filter((line) => line !== "");
  if (blobs.length !== files.length) return new Map();
  const still = await mapConcurrent(files, (file) => statOf(join(root, file.path)));
  const stored = new Map<RelativePath, FileHash>();
  files.forEach((file, i) => {
    const after = still[i];
    if (after !== null && after !== undefined && sameStat(file.stat, after)) {
      stored.set(file.path, blobs[i] as FileHash);
    }
  });
  return stored;
}

/** A file whose bytes, read once, are the ones its key was made of, with its stat then. */
interface KeyRead {
  readonly path: RelativePath;
  readonly stat: FileStat;
}

/**
 * The file at `path` with its stat when its bytes hash to `cached` and its
 * stat is outside the racy window; `null` otherwise, or for a path git
 * cannot take on a stdin line, or no regular file.
 */
async function keyRead(
  root: AbsolutePath,
  path: RelativePath,
  cached: FileHash,
): Promise<KeyRead | null> {
  if (path.includes("\n") || path.startsWith('"')) return null;
  const readAt = Date.now();
  try {
    // As `hashFile` opens a file: no symlink followed, no fifo blocks.
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const handle = await open(join(root, path), flags);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) return null;
      const stat = fileStat(stats);
      if (isRacy(stat, readAt)) return null;
      const bytes = await handle.readFile();
      const format = cached.length === 64 ? "sha256" : "sha1";
      return blobHash(bytes, format) === cached ? { path, stat } : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** The stat of a regular file at `path`, as the stat cache keeps it; `null` otherwise. */
async function statOf(path: string): Promise<FileStat | null> {
  return lstat(path).then(
    (stats) => (stats.isFile() ? fileStat(stats) : null),
    () => null,
  );
}

function fileStat(stats: {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  ino: number;
}): FileStat {
  return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
}
