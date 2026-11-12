import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Row 018-38, review 0.1.449 B1: a covered node:test process makes its
 * `NODE_V8_COVERAGE` folder, parents and all, as it exits. A store removed
 * while a run held its second file came back with the log folder, the run
 * found the folder there and reported the first file passed with its graphs
 * (its observed loads) lost. A run whose log folder went, store and all or
 * alone, stores nothing and makes nothing again, its queued files unstarted.
 */

const SLOW = { timeout: 60_000 } as const;
const scratch = mkdtempSync(join(tmpdir(), "squeal-018-38-r1-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const project: NodeTestProject = {
  name: "unit",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["*.test.mjs"],
};

/** A worktree whose store is `.git/squeal`: a file that loads `dep.mjs` at run time, a held one, a third. */
function worktree() {
  const dir = join(scratch, randomUUID());
  const root = join(dir, "worktree") as AbsolutePath;
  const store = join(root, ".git", "squeal");
  const logDir = join(store, "runs", "r1", "node-test", "unit") as AbsolutePath;
  const marks = { started: join(dir, "started"), release: join(dir, "release") };
  const third = join(dir, "third-ran");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(root, "dep.mjs"), "export const value = 1;\n");
  writeFileSync(
    join(root, "first.test.mjs"),
    lines(
      'import { test } from "node:test";',
      'test("first", async () => { await import("./" + "dep.mjs"); });',
    ),
  );
  writeFileSync(
    join(root, "held.test.mjs"),
    lines(
      'import { existsSync, writeFileSync } from "node:fs";',
      'import { test } from "node:test";',
      'test("held", async () => {',
      `  writeFileSync(${JSON.stringify(marks.started)}, "");`,
      `  while (!existsSync(${JSON.stringify(marks.release)})) await new Promise((r) => setTimeout(r, 10));`,
      "});",
    ),
  );
  writeFileSync(
    join(root, "third.test.mjs"),
    lines(
      'import { writeFileSync } from "node:fs";',
      'import { test } from "node:test";',
      `test("third", () => writeFileSync(${JSON.stringify(third)}, ""));`,
    ),
  );
  return { root, store, logDir, marks, third };
}

/** Runs `files` covered, one at a time, and removes `gone` of the worktree once the held file started. */
async function removedWhileHeld(gone: "store" | "logDir", files: readonly string[]) {
  const tree = worktree();
  const running = runNodeTest({
    root: tree.root,
    logDir: tree.logDir,
    project,
    files: files.map((path) => ({ project: "unit", path })),
    timeoutMs: 60_000,
    concurrency: 1,
    covered: () => true,
  });
  try {
    for (let waited = 0; !existsSync(tree.marks.started); waited += 20) {
      if (waited > 45_000) throw new Error("the held file never started");
      await new Promise((r) => setTimeout(r, 20));
    }
    const removed = gone === "store" ? tree.store : tree.logDir;
    rmSync(removed, { recursive: true });
    writeFileSync(tree.marks.release, "");
    return { ...tree, removed, result: await running };
  } finally {
    writeFileSync(tree.marks.release, "");
    await running.catch(() => {});
  }
}

describe("a covered node:test run whose log folder went (row 018-38, review 0.1.449 B1)", () => {
  it.each(["store", "logDir"] as const)(
    "reports nothing of the file that passed before its %s went, and makes nothing again",
    SLOW,
    async (gone) => {
      const { result, removed } = await removedWhileHeld(gone, ["first.test.mjs", "held.test.mjs"]);
      expect(existsSync(removed)).toBe(false);
      expect(result.report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
      expect(result.observed).toEqual([]);
    },
  );

  it("starts none of its queued files once the store went", SLOW, async () => {
    const { result, store, third } = await removedWhileHeld("store", [
      "first.test.mjs",
      "held.test.mjs",
      "third.test.mjs",
    ]);
    expect(existsSync(third)).toBe(false);
    expect(existsSync(store)).toBe(false);
    expect(result.report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
  });

  it(
    "still writes a covered run's coverage and log under a store that is there",
    SLOW,
    async () => {
      const tree = worktree();
      writeFileSync(tree.marks.release, "");
      const result = await runNodeTest({
        root: tree.root,
        logDir: tree.logDir,
        project,
        files: ["first.test.mjs"].map((path) => ({ project: "unit", path })),
        timeoutMs: 60_000,
        covered: () => true,
      });
      expect(result.report.completedFiles).toEqual([{ project: "unit", path: "first.test.mjs" }]);
      expect(readdirSync(tree.logDir)).toEqual(expect.arrayContaining(["cov-0", "run.json"]));
      expect(readdirSync(join(tree.logDir, "cov-0")).some((n) => n.startsWith("coverage-"))).toBe(
        true,
      );
    },
  );
});
