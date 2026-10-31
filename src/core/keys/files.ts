import { readdir, readFile, stat } from "node:fs/promises";
import { sep } from "node:path";
import { compare, isMissing } from "../fs/index.js";
import type { AbsolutePath } from "../types/index.js";

/** The bytes of the file at `path`, or `null` when it is missing or not a file. */
export async function readIfFile(path: AbsolutePath): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Entries below `dir`, relative to it with `/` separators, sorted. Empty when `dir` is missing. */
export async function listEntries(dir: AbsolutePath): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.map((entry) => entry.split(sep).join("/")).sort(compare);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
