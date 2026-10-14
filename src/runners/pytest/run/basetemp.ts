import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../../core/types/index.js";
import { runScratch } from "./bytecode.js";

export interface RunBasetemp {
  /** Batch `index`'s `--basetemp`, which pytest creates and clears. */
  dir(index: number): AbsolutePath;
  /** Removes every batch's basetemp. */
  remove(): void;
}

/**
 * The basetemps of one run (task 007-37). pytest's own is
 * `<tmp>/pytest-of-<user>/pytest-<n>`, one `<n>` higher every session, so a
 * failure naming its `tmp_path` was a different failure every run, and
 * Squeal's sessions pruned the user's own kept ones. Each batch gets
 * `<cacheDir>/basetemp-runs/run-<random>/<index>`, removed with the run;
 * D6's `-n 0` keeps xdist from adding its own below it.
 */
export function runBasetemp(cacheDir: AbsolutePath): RunBasetemp {
  const scratch = runScratch(join(cacheDir, "basetemp-runs"));
  // pytest writes the basetemp resolved; the text is matched against that spelling.
  const real = realpathSync(scratch.dir);
  return {
    dir: (index) => join(real, String(index)) as AbsolutePath,
    remove: scratch.remove,
  };
}

/**
 * Failure text with a batch's basetemp written as Squeal writes it every
 * run: a directory just below it, a test's numbered `tmp_path` or a
 * factory's `mktemp`, as `<tmp_path>`; the basetemp itself as `<basetemp>`.
 */
export function scrubBasetemp(text: string, basetemp: AbsolutePath): string {
  return text
    .split(`${basetemp}/`)
    .map((part, i) => (i === 0 ? part : part.replace(/^[^/\s'"`):,]*/, "<tmp_path>")))
    .join("")
    .replace(new RegExp(`${escapeRegExp(basetemp)}(?![\\w.-])`, "g"), "<basetemp>");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
