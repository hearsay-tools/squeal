import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { makeLogDir } from "../../src/runners/log-dir.js";

/*
 * Row 018-38: a runner host whose daemon was killed logs its cancelled run
 * late. A recursive mkdir of the run's log folder made `.git/squeal/runs/<id>`
 * again after a test's teardown removed it, and a whole removed checkout. A
 * run's log folder is made only below a store folder that still exists.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-log-dir-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout whose store, `.git/squeal`, exists without `runs/`, as before a first run. */
function checkout(): { root: string; store: string; run: AbsolutePath } {
  const root = join(scratch, randomUUID());
  const store = join(root, ".git", "squeal");
  mkdirSync(store, { recursive: true });
  return { root, store, run: join(store, "runs", randomUUID()) as AbsolutePath };
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

describe("makeLogDir (row 018-38)", () => {
  it("makes a first run's folder in a fresh store, `runs/` too", () => {
    const { store, run } = checkout();
    expect(makeLogDir(run)).toBe(true);
    expect(isDir(join(store, "runs"))).toBe(true);
    expect(isDir(run)).toBe(true);
  });

  it("makes a run's folder beside earlier runs, and one that is there already", () => {
    const { run } = checkout();
    const next = join(run, "..", randomUUID()) as AbsolutePath;
    expect(makeLogDir(run)).toBe(true);
    expect(makeLogDir(next)).toBe(true);
    expect(makeLogDir(next)).toBe(true);
    expect(isDir(next)).toBe(true);
  });

  it("makes nothing when the store was removed, and says so", () => {
    const { store, run } = checkout();
    rmSync(store, { recursive: true });
    expect(makeLogDir(run)).toBe(false);
    expect(existsSync(store)).toBe(false);
  });

  it("makes nothing when the whole checkout was removed", () => {
    const { root, run } = checkout();
    rmSync(root, { recursive: true });
    expect(makeLogDir(run)).toBe(false);
    expect(existsSync(root)).toBe(false);
  });

  it("makes a runner's folder inside the run's (node:test, pytest, a remote's local run)", () => {
    const { store, run } = checkout();
    for (const inside of [join(run, "node-test", "unit"), join(run, "here")]) {
      expect(makeLogDir(inside as AbsolutePath)).toBe(true);
      expect(isDir(inside)).toBe(true);
    }
    const gone = checkout();
    rmSync(gone.store, { recursive: true });
    expect(makeLogDir(join(gone.run, "pytest", "small") as AbsolutePath)).toBe(false);
    expect(existsSync(gone.store)).toBe(false);
    expect(isDir(store)).toBe(true);
  });

  it("takes the nearest `runs` above the folder as the store's, whatever folders above it are called", () => {
    const root = join(scratch, "runs", randomUUID());
    const store = join(root, ".git", "squeal");
    mkdirSync(store, { recursive: true });
    rmSync(store, { recursive: true });
    expect(makeLogDir(join(store, "runs", "r1") as AbsolutePath)).toBe(false);
    expect(existsSync(store)).toBe(false);
  });

  it("makes a folder outside any `runs` folder whole, as a caller's own", () => {
    const own = join(scratch, randomUUID(), "logs", "r1") as AbsolutePath;
    expect(makeLogDir(own)).toBe(true);
    expect(isDir(own)).toBe(true);
  });
});
