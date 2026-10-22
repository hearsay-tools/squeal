import { lstatSync, readdirSync, type Stats } from "node:fs";
import type { AbsolutePath } from "../types/index.js";

/*
 * Spec 014 D2 and D7: the file reads and the process names the stages
 * share. Each read gives empty or `null` for what is not there, as every
 * read of the source does (D11).
 */

/** D2 step 1: Node 24 names its main thread `MainThread`; older Node, `node`. */
export const NODE_COMMS: ReadonlySet<string> = new Set(["MainThread", "node"]);

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
