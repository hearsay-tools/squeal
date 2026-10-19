import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { afterEachRun, EscapedChildren } from "../../src/core/daemon/escaped.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import type { RunnerAdapter } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 011 C4 step 5 as amended 2026-10-19 (task 011-21): whether an edit's
 * tier starts beside a backlog tier of its lane comes from the runner, not
 * the lane's name. node:test and pytest say so before their adapter is
 * built; Vitest says nothing, so its edit cancels the backlog tier; every
 * wrapper the daemon puts around them asks a file's owner.
 */
describe("runners: an edit's tier beside the backlog tier (task 011-21)", () => {
  it("is node:test's and pytest's, not Vitest's, through the composite, the slow instance and the sweep", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-beside-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const common = {
      root: dir,
      store: open(fakeCommonDir()),
      tempDir: dir,
      tierSize: () => 4,
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
    const NT = { project: "nt", path: "nt/a.mjs" };
    const PY = { project: "py", path: "py/test_a.py" };
    const VITEST = { project: "", path: "test/a.test.ts" };
    expect(nt.besideBacklog?.(NT)).toBe(true);
    expect(py.besideBacklog?.(PY)).toBe(true);

    const vitest = createRecoveringRunner({
      name: "vitest",
      adapterVersion: "1",
      create: async (): Promise<RunnerAdapter> => {
        throw new Error("not built here");
      },
      onFailure: () => {},
    });
    expect(vitest.besideBacklog?.(VITEST)).toBe(false);

    const owned = (runner: RunnerAdapter, project: string): RunnerAdapter =>
      Object.create(runner, {
        testFiles: { value: async () => [{ project, path: `${project}/a` }] },
      });
    const composite = createCompositeRunner([
      owned(vitest, ""),
      owned(
        withSlowInstance(nt, () => nt),
        "nt",
      ),
      owned(py, "py"),
    ]);
    await composite.testFiles();
    const daemon = afterEachRun(composite, new EscapedChildren(), () => {});
    expect(daemon.besideBacklog?.(VITEST)).toBe(false);
    expect(daemon.besideBacklog?.(NT)).toBe(true);
    expect(daemon.besideBacklog?.(PY)).toBe(true);
  });
});
