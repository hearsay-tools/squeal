import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, readlink } from "node:fs/promises";
import type { AbsolutePath, FileHash } from "../types/index.js";

/** Git object format of a repository: `extensions.objectFormat`. */
export type ObjectFormat = "sha1" | "sha256";

/**
 * Git blob id of `bytes`, lowercase hex.
 *
 * Spec 001 D3: "the git blob id of the bytes on disk, `sha1(\"blob <len>\\0\"
 * + bytes)` (SHA-256 in `objectFormat=sha256` repositories)."
 */
export function blobHash(bytes: Uint8Array, format: ObjectFormat): FileHash {
  return createHash(format).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

/**
 * Never follows a symlink at the last component (`ELOOP` instead), never
 * blocks on a fifo. Only a regular file is read after opening.
 */
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Blob id of what git would store for `path`, or `null` when there is no
 * file. No git filters apply.
 *
 * One stat definition everywhere (`FileStat`): symlinks are described, not
 * followed. A symlink hashes as git stores it, the blob of its target path;
 * a directory, fifo, socket or device is no file. The type is taken from the
 * open handle, so no extra stat of the path is needed.
 */
export async function hashFile(path: AbsolutePath, format: ObjectFormat): Promise<FileHash | null> {
  // A symlink replaced by a file between `open` and `readlink` is retried once.
  for (let attempt = 0; ; attempt++) {
    let handle: FileHandle;
    try {
      handle = await open(path, OPEN_FLAGS);
    } catch (error) {
      if (isMissing(error)) return null;
      if (errorCode(error) !== "ELOOP") throw error;
      const target = await readlinkOrNull(path, attempt > 0);
      if (target === undefined) continue;
      return target === null ? null : blobHash(target, format);
    }
    try {
      if (!(await handle.stat()).isFile()) return null;
      return blobHash(await handle.readFile(), format);
    } finally {
      await handle.close();
    }
  }
}

/** Target bytes of a symlink; `null` when gone; `undefined` when no longer a symlink (retry). */
async function readlinkOrNull(
  path: AbsolutePath,
  last: boolean,
): Promise<Buffer | null | undefined> {
  try {
    return await readlink(path, { encoding: "buffer" });
  } catch (error) {
    if (isMissing(error)) return null;
    if (errorCode(error) === "EINVAL" && !last) return undefined;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** True for errors meaning "no such file", including a path through a file or a directory read. */
export function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
