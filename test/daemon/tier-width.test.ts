import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import type { RunnerAdapter } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 011 C4 step 5 (task 001-366): a backlog tier is budgeted over the
 * workers its runner runs it with. node:test and pytest start
 * `runner.tierSize` files at once whatever the grant, so they report that,
 * before their adapter is even built; the composite asks a file's owner.
 */
describe("runners: the width of a backlog tier (task 001-366)", () => {
  it("is runner.tierSize for node:test and pytest, read per call, and the owner's in a composite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-tier-width-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    let tierSize = 4;
    const common = {
      root: dir,
      store: open(fakeCommonDir()),
      tempDir: dir,
      tierSize: () => tierSize,
      note: () => {},
    };
    const [nt] = createNodeTestRunners(
      [{ name: "nt", cwd: "nt", node: process.execPath, argv: [], env: {}, include: ["*.mjs"] }],
      common,
    );
    const [py] = createPytestRunners(
      [{ name: "py", cwd: "py", args: [], env: {}, include: ["test_*.py"] }],
      { ...common, stateDir: dir },
    );
    if (nt === undefined || py === undefined) throw new Error("no runners");
    expect(nt.tierWidth?.({ project: "nt", path: "nt/a.mjs" }, 23)).toBe(4);
    expect(py.tierWidth?.({ project: "py", path: "py/test_a.py" }, 1)).toBe(4);
    tierSize = 6;
    expect(nt.tierWidth?.({ project: "nt", path: "nt/a.mjs" }, 23)).toBe(6);

    const wide: RunnerAdapter = {
      name: "wide",
      adapterVersion: "1",
      invalidate: async () => ({ recreatedProjects: [] }),
      affected: async () => ({ direct: [], transitive: [] }),
      closure: async (testFile) => ({ testFile, paths: [] }),
      enumerate: async () => [],
      testFiles: async () => [{ project: "", path: "test/a.test.ts" }],
      environment: async () => [],
      tierWidth: (_, grant) => Math.max(2, grant),
      run: async () => {
        throw new Error("not run here");
      },
      close: async () => {},
    };
    const fake = (project: string): RunnerAdapter => ({
      ...wide,
      name: project,
      testFiles: async () => [{ project, path: `${project}/a` }],
      tierWidth: () => 3,
    });
    const composite = createCompositeRunner([wide, fake("other")]);
    await composite.testFiles();
    expect(composite.tierWidth?.({ project: "", path: "test/a.test.ts" }, 1)).toBe(2);
    expect(composite.tierWidth?.({ project: "other", path: "other/a" }, 23)).toBe(3);
  });
});
