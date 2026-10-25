import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AbsolutePath,
  FocusedFile,
  PytestProject,
  RunnerAdapter,
  RunReport,
} from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import { pythonEnv, requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";

/*
 * Row 011-135 R1 (spec 011 C14, 007 D6): a run given texts for a file sets
 * `SQUEAL_PYTEST_CHECKS`, and `squeal_pytest` deselects every item whose
 * full name, the node id after the first `::`, holds no text. Real pytest
 * through the adapter, over a uv-synced copy of the small fixture.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const PROJECT: PytestProject = { name: "small", args: [], env: {}, include: ["tests/test_f*.py"] };

const FOUR = [
  "class TestParity:",
  "    def test_old_1(self):",
  "        assert True",
  "",
  "    def test_new_1(self):",
  "        assert 1 == 2",
  "",
  "    class TestInner:",
  "        def test_new_2(self):",
  "            assert True",
  "",
  "",
  "def test_new_3_top():",
  "    assert True",
  "",
].join("\n");
/** `core.computed` imports `app.plugins.alpha` by name: a path no static closure holds. */
const DYNAMIC = [
  "from app import core",
  "",
  "def test_dynamic_alpha():",
  '    assert core.computed("alpha") == 3',
  "",
  "def test_plain():",
  "    assert True",
  "",
].join("\n");
const SKIPPED = `import pytest\n\npytest.skip("no service", allow_module_level=True)\n\n${FOUR}`;

const ref = (name: string) => ({ project: "small", path: `tests/${name}.py` });
const FILE = ref("test_four");
const checks = (report: RunReport) => report.results.map((r) => [r.check.fullName, r.outcome]);

let synced: Synced = { ok: false, reason: "the sync did not run" };
let scratch = "";
let adapter: RunnerAdapter | null = null;
let root = "" as AbsolutePath;
let source: NodeJS.ProcessEnv = {};
const notes: string[] = [];
beforeAll(async () => {
  synced = syncFixture(small, "3.13");
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-focused-")));
  if (!synced.ok) return;
  root = realpathSync(synced.env.root) as AbsolutePath;
  writeFileSync(join(root, "tests/test_four.py"), FOUR);
  writeFileSync(join(root, "tests/test_four_broken.py"), `raise RuntimeError("cannot load")\n`);
  writeFileSync(join(root, "tests/test_four_skipped.py"), SKIPPED);
  writeFileSync(join(root, "tests/test_four_other.py"), "def test_other():\n    assert True\n");
  writeFileSync(join(root, "tests/test_four_dynamic.py"), DYNAMIC);
  const { PYTHONDONTWRITEBYTECODE: _, ...env } = pythonEnv();
  source = env;
  adapter = await createPytestAdapter(PROJECT, {
    root,
    source,
    note: (text) => notes.push(text),
    cacheDir: join(scratch, "cache") as AbsolutePath,
  });
}, 300_000);
afterAll(() => {
  if (synced.ok) synced.env.cleanup();
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
}, 60_000);

let runs = 0;
async function run(
  ctx: Parameters<typeof requireSynced>[0],
  names: string[],
  focus?: FocusedFile[],
) {
  requireSynced(ctx, synced);
  if (adapter === null) throw new Error("no adapter");
  const logDir = join(scratch, `logs-${runs++}`) as AbsolutePath;
  const report = await adapter.run(names.map(ref), {
    runId: "r",
    logDir,
    timeoutMs: 60_000,
    ...(focus === undefined ? {} : { checks: focus }),
  });
  return { report, logDir };
}

describe("pytest adapter: focused runs", SLOW, () => {
  it("runs and reports only the checks a text selects, the others deselected", async (ctx) => {
    const { report, logDir } = await run(ctx, ["test_four"], [{ testFile: FILE, texts: ["new"] }]);

    expect(adapter?.focuses).toBe(true);
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([FILE]);
    expect(checks(report)).toEqual([
      ["TestParity::test_new_1", "fail"],
      ["TestParity::TestInner::test_new_2", "pass"],
      ["test_new_3_top", "pass"],
    ]);
    expect(report.results[0]?.errors[0]?.message).toContain("assert 1 == 2");
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 4, matched: 3 }]);
    // pytest's own accounting: the left-out check counts as deselected.
    const stdout = readFileSync(join(logDir, "pytest/small/stdout-0.log"), "utf8");
    expect(stdout).toMatch(/1 failed, 2 passed, 1 deselected/);
  });

  it("selects with a text naming a nested class, and with any of several texts", async (ctx) => {
    const nested = await run(ctx, ["test_four"], [{ testFile: FILE, texts: ["TestInner::"] }]);
    expect(checks(nested.report)).toEqual([["TestParity::TestInner::test_new_2", "pass"]]);

    const two = await run(ctx, ["test_four"], [{ testFile: FILE, texts: ["old", "3_top"] }]);
    expect(checks(two.report)).toEqual([
      ["TestParity::test_old_1", "pass"],
      ["test_new_3_top", "pass"],
    ]);
  });

  it("reports matched 0 and no result for a text that selects nothing, never a pass", async (ctx) => {
    const { report } = await run(ctx, ["test_four"], [{ testFile: FILE, texts: ["no such"] }]);

    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([FILE]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors).toEqual([]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 4, matched: 0 }]);
    // pytest exits 5 when it deselected every item: not the note of a file that collects nothing.
    expect(notes.filter((n) => n.includes("collected nothing"))).toEqual([]);
  });

  it("reports the file-level error of a file that does not load", async (ctx) => {
    const broken = ref("test_four_broken");
    const { report } = await run(ctx, ["test_four_broken"], [{ testFile: broken, texts: ["new"] }]);

    expect(report.completedFiles).toEqual([broken]);
    expect(report.results).toEqual([]);
    expect(report.fileErrors.map((e) => [e.testFile, e.errors[0]?.message])).toEqual([
      [broken, "cannot load"],
    ]);
    expect(report.focused).toEqual([{ testFile: broken, collected: 0, matched: 0 }]);
  });

  it("skips only the selected checks of a module that skips itself", async (ctx) => {
    const skipped = ref("test_four_skipped");
    const { report } = await run(
      ctx,
      ["test_four_skipped"],
      [{ testFile: skipped, texts: ["old"] }],
    );

    expect(report.skippedFiles?.map((f) => f.testFile)).toEqual([skipped]);
    expect(checks(report)).toEqual([["TestParity::test_old_1", "skip"]]);
  });

  it("reports no observed path of a focused run; the file's whole run does (row 011-145)", async (ctx) => {
    requireSynced(ctx, synced);
    const observing = await createPytestAdapter(PROJECT, {
      root,
      source,
      note: (text) => notes.push(text),
      cacheDir: join(scratch, "cache") as AbsolutePath,
    });
    const DYNAMIC_FILE = ref("test_four_dynamic");
    const alpha = "src/app/plugins/alpha.py";
    const options = (n: number) => ({
      runId: `d${n}`,
      logDir: join(scratch, `dynamic-${n}`) as AbsolutePath,
      timeoutMs: 60_000,
    });

    const focused = await observing.run([DYNAMIC_FILE], {
      ...options(0),
      checks: [{ testFile: DYNAMIC_FILE, texts: ["dynamic_alpha"] }],
    });
    expect(checks(focused)).toEqual([["test_dynamic_alpha", "pass"]]);
    expect(focused.observed).toBeUndefined();
    expect(focused.environmentObserved).toBeUndefined();

    const whole = await observing.run([DYNAMIC_FILE], options(1));
    expect(checks(whole)).toEqual([
      ["test_dynamic_alpha", "pass"],
      ["test_plain", "pass"],
    ]);
    // 016 D4: the run reports it; the core keeps it and keys the file with it.
    expect(whole.observed?.find((o) => o.testFile.path === DYNAMIC_FILE.path)?.paths).toContain(
      alpha,
    );
    expect((await observing.closure(DYNAMIC_FILE)).paths).not.toContain(alpha);
    await observing.close();
  });

  it("runs a file without texts whole, in the same batch as a focused file", async (ctx) => {
    const other = ref("test_four_other");
    const { report } = await run(
      ctx,
      ["test_four", "test_four_other"],
      [{ testFile: FILE, texts: ["old"] }],
    );
    expect(report.completedFiles).toEqual([FILE, other]);
    expect(checks(report)).toEqual([
      ["TestParity::test_old_1", "pass"],
      ["test_other", "pass"],
    ]);
    expect(report.focused).toEqual([{ testFile: FILE, collected: 4, matched: 1 }]);

    const whole = await run(ctx, ["test_four"]);
    expect(checks(whole.report)).toEqual([
      ["TestParity::test_old_1", "pass"],
      ["TestParity::test_new_1", "fail"],
      ["TestParity::TestInner::test_new_2", "pass"],
      ["test_new_3_top", "pass"],
    ]);
    expect(whole.report.focused).toBeUndefined();
  });
});
