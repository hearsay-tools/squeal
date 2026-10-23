import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createCompositeRunner, focusesFile } from "../../src/core/daemon/composite-runner.js";
import { afterEachRun, EscapedChildren } from "../../src/core/daemon/escaped.js";
import { IdleGc } from "../../src/core/daemon/idle-gc.js";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import type { EpochMs, RunnerAdapter } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 011 C14 (row 011-145): a focused tier goes only to a file whose
 * adapter honours `RunOptions.checks`. Vitest's fast instance and pytest say
 * so before their adapter is built, node:test does not (row 011-156), and
 * every wrapper the daemon puts around them asks a file's owner, as for
 * `besideBacklog` (task 011-21).
 */
describe("runners: which files a focused tier may run (row 011-145)", () => {
  it("is Vitest's fast instance's and pytest's, not node:test's, through the composite, the slow instance and the sweep", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-focuses-"));
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
    expect(py.focuses).toBe(true);
    expect(nt.focuses).toBeUndefined();

    const vitest = (focuses: boolean) =>
      createRecoveringRunner({
        name: "vitest",
        adapterVersion: "1",
        create: async (): Promise<RunnerAdapter> => {
          throw new Error("not built here");
        },
        ...(focuses ? { focuses: true as const } : {}),
        onFailure: () => {},
      });
    const fast = vitest(true);
    // The daemon's slow instance is built without the option: a slow file gets no focused run.
    const slow = vitest(false);
    expect(fast.focuses).toBe(true);
    expect(slow.focuses).toBeUndefined();
    expect(focusesFile(slow, VITEST)).toBe(false);

    const owned = (runner: RunnerAdapter, project: string): RunnerAdapter =>
      Object.create(runner, {
        testFiles: { value: async () => [{ project, path: `${project}/a` }] },
      });
    const composite = createCompositeRunner([
      owned(
        withSlowInstance(fast, () => slow),
        "",
      ),
      owned(nt, "nt"),
      owned(py, "py"),
    ]);
    await composite.testFiles();
    const gc = new IdleGc({ now: () => 0 as EpochMs, note: () => {}, log: () => {} });
    const daemon = gc.track(afterEachRun(composite, new EscapedChildren(), () => {}));
    expect(daemon.focusesFile?.(VITEST)).toBe(true);
    expect(daemon.focusesFile?.(PY)).toBe(true);
    expect(daemon.focusesFile?.(NT)).toBe(false);
    // A project no adapter listed: no owner, so no focused run.
    expect(daemon.focusesFile?.({ project: "other", path: "x.test.ts" })).toBe(false);
  });
});
