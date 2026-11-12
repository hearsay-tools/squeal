import { mkdirSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { AbsolutePath } from "../core/types/common.js";

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
 * the caller's own and is made whole.
 */
export function makeLogDir(dir: AbsolutePath): boolean {
  const store = storeOf(dir);
  if (store === null) {
    mkdirSync(dir, { recursive: true });
    return true;
  }
  let at = store;
  for (const level of relative(store, dir).split(sep)) {
    at = join(at, level);
    try {
      mkdirSync(at);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return false;
      if (code !== "EEXIST") throw error;
    }
  }
  return true;
}

/** The parent of the nearest `runs` folder above `dir`; `null` without one. */
function storeOf(dir: string): string | null {
  for (let at = dirname(dir); at !== dirname(at); at = dirname(at)) {
    if (basename(at) === RUNS) return dirname(at);
  }
  return null;
}
