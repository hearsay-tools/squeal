import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { AbsolutePath } from "../core/types/common.js";
import type { RunReport } from "../core/types/runner.js";

/*
 * Row 018-38: a run's log folder is made only below a store folder that still
 * exists. A runner host whose daemon was killed cancels its run and logs it
 * late, when a test's teardown or the user may have removed `.git/squeal` or
 * the whole checkout; a recursive mkdir made them again. The run's results
 * went nowhere then, since its daemon is gone, so its log goes nowhere too.
 */

/** Spec 001 D1: a run logs to `<store>/runs/<run-id>`. */
const RUNS = "runs";

/**
 * Makes `dir`, a run's log folder or one inside it, one missing level at a
 * time below the store that holds it, so a store removed meanwhile stays
 * removed. The store is the folder holding the nearest `runs` above `dir`:
 * `<store>/runs/<run-id>`, a runner's `<run>/node-test/<project>`, a remote's
 * local `<run>/here` and the gate's `<temp>/runs/<i>` alike. `false`, having
 * made nothing, when that store is gone. A folder with no `runs` above it is
 * the caller's own: made below the nearest folder that exists, whole.
 */
export function makeLogDir(dir: AbsolutePath): boolean {
  let at = storeOf(dir) ?? existing(dirname(dir));
  for (const level of relative(at, dir).split(sep)) {
    at = join(at, level);
    try {
      mkdirSync(at);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return true;
}

/**
 * The report of a run whose log folder `dir` is gone: `makeLogDir` could not
 * make it, or it went while the run ran. A runner whose processes write their
 * records there (node:test, pytest) starts none then, and one whose records
 * went with the folder reports none of them (row 018-38).
 */
export function logGoneReport(dir: AbsolutePath): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: `Squeal's run log folder ${dir} is gone; the run reports nothing`,
  };
}

/** `dir`, or the nearest folder above it that exists. */
function existing(dir: string): string {
  return existsSync(dir) ? dir : existing(dirname(dir));
}

/** The parent of the nearest `runs` folder above `dir`; `null` without one. */
function storeOf(dir: string): string | null {
  for (let at = dirname(dir); at !== dirname(at); at = dirname(at)) {
    if (basename(at) === RUNS) return dirname(at);
  }
  return null;
}
