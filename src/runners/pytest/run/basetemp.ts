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

/** A character of one path component in failure text, and what ends one. */
const NAME = "[^/\\s'\"`):,]";
const END = "[/\\s'\"`):,]";

/**
 * Failure text with a batch's basetemp written as Squeal writes it every
 * run: the basetemp itself as `<basetemp>`, and the counter pytest appends
 * to a numbered directory just below it, a test's `tmp_path` or a factory's
 * `mktemp`, as `<n>` (`test_reads0` is `test_reads<n>`). Task 007-41: no
 * other part of a path is replaced, so two failures naming two different
 * files keep two fingerprints.
 */
export function scrubBasetemp(text: string, basetemp: AbsolutePath): string {
  const numbered = `/(${NAME}*?)\\d+(?=${END}|$)`;
  return text.replace(
    new RegExp(`${escapeRegExp(basetemp)}(?:${numbered})?(?![\\w.-])`, "g"),
    (_, prefix: string | undefined) =>
      prefix === undefined ? "<basetemp>" : `<basetemp>/${prefix}<n>`,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
