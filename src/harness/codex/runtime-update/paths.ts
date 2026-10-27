import { statSync } from "node:fs";
import { join } from "node:path";
import { SEED } from "../adapter/store.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): the updater's files in
 * Codex's `PLUGIN_DATA`, beside the store's `runtime/current.json` and
 * session pins. Only the lock owner writes the state and the staging
 * directory.
 */

/** The last check's result and the time of the next scheduled one. */
export const updateStateFile = (data: string): string => join(data, "runtime", "update.json");

/** One updater at a time per data directory. */
export const lockFile = (data: string): string => join(data, "runtime", "update.lock");

/**
 * Where artifacts are staged: on the file system of `versions/`, so
 * publication renames. Leftovers there are removed only under the lock.
 */
export const stagingDir = (data: string): string => join(data, "runtime", "staging");

/** The prefix `stageRuntimeArtifact` gives each staging tree (row 002-30). */
export const STAGED_PREFIX = "squeal-runtime-";

/**
 * Whether `root` is the fixed plugin's adapter: it has `hooks/hooks.json`
 * and the seed. A retained runtime has a plugin manifest too, and is not one
 * (`wave-5-contract.md`).
 */
export function isAdapterRoot(root: string): boolean {
  try {
    return (
      statSync(join(root, "hooks", "hooks.json")).isFile() &&
      statSync(join(root, SEED)).isDirectory()
    );
  } catch {
    return false;
  }
}
