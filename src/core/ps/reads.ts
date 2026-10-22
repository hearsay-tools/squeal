import { lstatSync, readdirSync, type Stats } from "node:fs";
import type { AbsolutePath } from "../types/index.js";

/*
 * Spec 014 D2 and D7: the file reads the stages share. Each reads as empty
 * or `null` what is not there, as every read of the source does (D11).
 */

/** The names in `dir`, sorted; none when it is missing or cannot be read. */
export function names(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    // No such directory: nothing of this kind was made there.
    return [];
  }
}

export function lstatOrNull(path: AbsolutePath): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    // Removed since the listing, or unreadable: there is no file to judge.
    return null;
  }
}
