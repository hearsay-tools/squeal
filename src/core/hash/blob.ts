import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

/** Blob id of a file's bytes, or `null` when it does not exist. No git filters apply. */
export async function hashFile(path: AbsolutePath, format: ObjectFormat): Promise<FileHash | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return blobHash(bytes, format);
}

/** True for errors meaning "no such file", including a path through a file or a directory read. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
