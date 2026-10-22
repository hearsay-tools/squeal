import { lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { slowSlotDir } from "../slow/index.js";
import type { AbsolutePath } from "../types/index.js";
import type { PsPlaces } from "./model.js";

/*
 * Spec 014 D2, D6 and D7: the file reads, the process names and the pool's
 * directories the stages share. Each read gives empty or `null` for what is
 * not there, as every read of the source does (D11).
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

/**
 * The pool's directories, `slowSlotDir` of a daemon started without the
 * runtime directory `ps` sees and of one started with it: each daemon picks
 * one by its own environment (004 D2).
 */
export function poolDirs(places: PsPlaces): AbsolutePath[] {
  const userDir = join(places.tempDir, `squeal-${places.uid}`);
  const envs = places.runtimeDir === null ? [{}] : [{}, { XDG_RUNTIME_DIR: places.runtimeDir }];
  return [...new Set(envs.map((env) => slowSlotDir(env, userDir)))];
}
