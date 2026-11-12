import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import type { Covering } from "../../../src/runners/node-test/run/coverage.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Row 020-36 (020 D12.6 as amended 2026-11-12): the module recorder rides in
 * `NODE_OPTIONS`, so a process the test spawns loads it too. Row 018-38's
 * rule holds there: a covered run's processes write V8 coverage through the
 * run's links outside the store (`CoverageLinks`), the child as the test
 * file's own process, so a store removed while a child ran is never made
 * again. The child writes what it sees of Squeal's variables beside the
 * worktree, then, when told, removes the store as its last act.
 */

const SLOW = { timeout: 60_000 } as const;
const scratch = mkdtempSync(join(tmpdir(), "squeal-020-36-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const project: NodeTestProject = {
  name: "unit",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["*.test.mjs"],
};
const FILE = { project: "unit", path: "spawns.test.mjs" };

/** A worktree whose store is `.git/squeal`; its test runs `child.mjs`, which loads `dep.mjs`. */
function worktree(removesStore: boolean) {
  const dir = join(scratch, randomUUID());
  const root = join(dir, "worktree") as AbsolutePath;
  const store = join(root, ".git", "squeal");
  const logDir = join(store, "runs", "r1", "node-test", "unit") as AbsolutePath;
  const seen = join(dir, "child-env.json");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(root, "dep.mjs"), "export const value = 1;\n");
  writeFileSync(
    join(root, "child.mjs"),
    lines(
      'import { rmSync, writeFileSync } from "node:fs";',
      'import { value } from "./dep.mjs";',
      "const { NODE_V8_COVERAGE, SQUEAL_NODE_TEST_COVERAGE } = process.env;",
      `writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ NODE_V8_COVERAGE, SQUEAL_NODE_TEST_COVERAGE, value }));`,
      removesStore ? `rmSync(${JSON.stringify(store)}, { recursive: true });` : "",
    ),
  );
  writeFileSync(
    join(root, "spawns.test.mjs"),
    lines(
      'import { execFileSync } from "node:child_process";',
      'import { test } from "node:test";',
      'test("spawns", () => { execFileSync(process.execPath, ["child.mjs"]); });',
    ),
  );
  return { root, store, logDir, seen };
}

async function covered(covering: Covering, removesStore: boolean) {
  const tree = worktree(removesStore);
  const result = await runNodeTest({
    root: tree.root,
    logDir: tree.logDir,
    project,
    files: [FILE],
    timeoutMs: 30_000,
    covered: () => covering,
  });
  const child = JSON.parse(readFileSync(tree.seen, "utf8")) as Record<string, unknown>;
  return { ...tree, result, child };
}

/** Where `CoverageLinks` puts the link of the run's file 0. */
const LINK = new RegExp(
  `^${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/squeal-coverage-[^/]+/cov-0`,
);

describe("a child of a covered node:test run (rows 020-36, 018-38)", () => {
  it(
    "is recorded and writes its coverage through the run's link into the log folder",
    SLOW,
    async () => {
      const { result, child, logDir } = await covered("children", false);
      expect(result.report.completedFiles).toEqual([FILE]);
      expect(result.observed[0]?.paths).toEqual(["child.mjs", "dep.mjs", FILE.path]);
      expect(result.observed[0]?.direct).toEqual(["child.mjs", "dep.mjs"]);
      expect(child.SQUEAL_NODE_TEST_COVERAGE).toBeUndefined();
      expect(child.NODE_V8_COVERAGE).toMatch(new RegExp(`${LINK.source}/children$`));
      const children = readdirSync(join(logDir, "cov-0", "children"));
      expect(children.filter((name) => name.startsWith("coverage-"))).toHaveLength(1);
    },
  );

  it("without coverage.children sees no coverage folder at all", SLOW, async () => {
    const { result, child, logDir } = await covered(true, false);
    expect(result.observed[0]?.direct).toEqual(["child.mjs", "dep.mjs"]);
    expect(child).toEqual({ value: 1 });
    expect(existsSync(join(logDir, "cov-0", "children"))).toBe(false);
  });

  it.each([true, "children"] as const)(
    "with coverage %s, makes no store again after it removed the store",
    SLOW,
    async (covering) => {
      const { result, store, child } = await covered(covering, true);
      expect(child.value).toBe(1);
      expect(existsSync(store)).toBe(false);
      expect(result.report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
      expect(result.observed).toEqual([]);
    },
  );
});
