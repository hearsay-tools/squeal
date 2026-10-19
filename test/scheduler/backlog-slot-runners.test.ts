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
 * Spec 011 C4 step 5 as amended for slots (task 011-21 slice 2): whether a
 * lane runs its backlog in slots, and how many files a slot takes, comes
 * from the runner before its adapter is built: node:test one file, pytest
 * its project's batch size; Vitest none, so its backlog keeps tiers. Every
 * wrapper the daemon puts around them asks a file's owner.
 */
describe("runners: a backlog slot's files (task 011-21 slice 2)", () => {
  it("is 1 for node:test, the batch size for pytest, none for Vitest, through every wrapper", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-slot-"));
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
    const [py, batched] = createPytestRunners(
      [
        { name: "py", cwd: "py", args: [], env: {}, include: ["test_*.py"] },
        { name: "pb", cwd: "pb", args: [], env: {}, include: ["test_*.py"], batchSize: 2 },
      ],
      { ...common, stateDir: dir },
    );
    if (nt === undefined || py === undefined || batched === undefined) {
      throw new Error("no runners");
    }
    const NT = { project: "nt", path: "nt/a.mjs" };
    const PY = { project: "py", path: "py/test_a.py" };
    const PB = { project: "pb", path: "pb/test_a.py" };
    const VITEST = { project: "", path: "test/a.test.ts" };
    expect(nt.backlogSlot?.(NT)).toBe(1);
    expect(py.backlogSlot?.(PY)).toBe(5);
    expect(batched.backlogSlot?.(PB)).toBe(2);

    const vitest = createRecoveringRunner({
      name: "vitest",
      adapterVersion: "1",
      create: async (): Promise<RunnerAdapter> => {
        throw new Error("not built here");
      },
      onFailure: () => {},
    });
    expect(vitest.backlogSlot?.(VITEST)).toBeNull();

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
      owned(batched, "pb"),
    ]);
    await composite.testFiles();
    const daemon = afterEachRun(composite, new EscapedChildren(), () => {});
    expect(daemon.backlogSlot?.(VITEST)).toBeNull();
    expect(daemon.backlogSlot?.(NT)).toBe(1);
    expect(daemon.backlogSlot?.(PY)).toBe(5);
    expect(daemon.backlogSlot?.(PB)).toBe(2);
  });
});
