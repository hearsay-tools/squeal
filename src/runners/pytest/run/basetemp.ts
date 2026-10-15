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

/** What ends one path component in failure text. */
const END = "[/\\s'\"`):,]";

/**
 * Failure text with a batch's basetemp written as Squeal writes it every
 * run: the basetemp itself as `<basetemp>`, and the counter pytest appends
 * to the test's own `tmp_path` folder as `<n>` (`test_reads0` is
 * `test_reads<n>`). `name` is the test's node name; without one, as for a
 * collection error, only the basetemp is replaced. Tasks 007-41, 007-43: no
 * other part of a path is replaced, so `data1` and `data2` keep two
 * fingerprints, and a pytest that named the folder otherwise would match
 * nothing.
 */
export function scrubBasetemp(text: string, basetemp: AbsolutePath, name?: string): string {
  const folder = name === undefined ? null : tmpPathFolder(name);
  const own = folder === null ? "" : `(?:/${escapeRegExp(folder)}\\d+(?=${END}|$))?`;
  return text.replace(new RegExp(`${escapeRegExp(basetemp)}${own}(?![\\w.-])`, "g"), (match) =>
    match === basetemp ? "<basetemp>" : `<basetemp>/${folder}<n>`,
  );
}

/**
 * pytest's `_mk_tmp`: `re.sub(r"[\W]", "_", request.node.name)[:30]`, then
 * `mktemp(name, numbered=True)`. Python's `\W` is Unicode-aware: anything but
 * a letter, a number or `_`, and the cut counts code points.
 */
function tmpPathFolder(name: string): string {
  return Array.from(name.replace(/[^\p{L}\p{N}_]/gu, "_"))
    .slice(0, 30)
    .join("");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
