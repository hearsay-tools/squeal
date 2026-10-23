import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../../../src/core/types/index.js";
import { readEnvironment } from "../../../../src/runners/pytest/environment/index.js";
import { type PytestRunOptions, runPytest } from "../../../../src/runners/pytest/run/run.js";
import { runSummary } from "../../../../src/runners/run-summary.js";
import {
  PYTHONS,
  pythonEnv,
  requireSynced,
  type Synced,
  syncFixture,
} from "../../../helpers/pytest-env.js";

/*
 * Spec 007 D6 and the runner tests of its Testing list, live: `runPytest`
 * over a uv-synced copy of the small fixture on both CI Pythons. Bytecode
 * writing stays on, so the check that nothing lands in the tree means
 * something.
 */

const small = resolve(import.meta.dirname, "../../../fixtures/pytest/small");
const SLOW = { timeout: 90_000 } as const;
/** Removing a synced fixture copy, `.venv` and all, under a loaded suite. */
const CLEANUP_MS = 60_000;
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};

const refs = (...paths: string[]): TestFileRef[] =>
  paths.map((path) => ({ project: "small", path }));
const outcomes = (results: readonly { check: { fullName: string }; outcome: string }[]) =>
  Object.fromEntries(results.map((r) => [r.check.fullName, r.outcome]));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(what: string, ms: number, check: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Every `__pycache__` and `.pytest_cache` under `dir`, `.venv` left out. */
function artefacts(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (!entry.isDirectory() || entry.name === ".venv") return [];
    if (entry.name === "__pycache__" || entry.name === ".pytest_cache") return [path];
    return artefacts(dir, path);
  });
}

describe.each(PYTHONS)("runPytest under Python %s (spec 007 D6)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  beforeAll(() => {
    synced = syncFixture(small, version);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-run-")));
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  }, CLEANUP_MS);

  let runs = 0;
  async function run(
    ctx: Parameters<typeof requireSynced>[0],
    files: readonly TestFileRef[],
    options: Partial<PytestRunOptions> & { project?: PytestProject } = {},
  ) {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const project = options.project ?? PROJECT;
    const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
    const environment = await readEnvironment(root, project, source);
    if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
    const logDir = join(scratch, `logs-${runs++}`) as AbsolutePath;
    const result = await runPytest({
      root,
      project,
      environment,
      files,
      logDir,
      timeoutMs: 60_000,
      cacheDir: join(scratch, "cache") as AbsolutePath,
      ...options,
    });
    return { ...result, root, logDir };
  }

  it(
    "joins phases, and a collection error in one file of a batch leaves the others' results",
    SLOW,
    async (ctx) => {
      const files = refs(
        "outcomes/test_phases.py",
        "outcomes/test_collection_error.py",
        "outcomes/test_fail.py",
        "outcomes/test_module_skip.py",
        "outcomes/test_pass.py",
      );
      const { report, skippedFiles } = await run(ctx, files);
      expect(report.end).toBe("completed");
      expect(report.failure).toBeNull();
      expect(report.completedFiles).toEqual(files);
      expect(outcomes(report.results)).toEqual({
        test_setup_error: "fail",
        test_teardown_error: "fail",
        test_skip: "skip",
        test_xfail: "skip",
        test_xpass: "pass",
        test_strict_xpass: "fail",
        test_passes_beside_the_failure: "pass",
        test_fails: "fail",
        test_passes: "pass",
      });
      expect(report.fileErrors).toMatchObject([
        {
          testFile: { path: "outcomes/test_collection_error.py" },
          errors: [{ name: "ModuleNotFoundError" }],
        },
      ]);
      expect(skippedFiles.map((s) => s.testFile.path)).toEqual(["outcomes/test_module_skip.py"]);
    },
  );

  it(
    "kills a hung test and its child at the deadline and keeps the batch's completed file",
    SLOW,
    async (ctx) => {
      const pidFile = join(scratch, "hang.pid");
      const project = { ...PROJECT, env: { FIXTURE_HANG_PID_FILE: pidFile } };
      const { report } = await run(ctx, refs("outcomes/test_pass.py", "outcomes/test_hang.py"), {
        project,
        timeoutMs: 10_000,
      });
      expect(report.end).toBe("timed-out");
      expect(report.failure).toContain("1 of 2 test files unfinished");
      expect(report.completedFiles).toEqual(refs("outcomes/test_pass.py"));
      expect(outcomes(report.results)).toEqual({ test_passes: "pass" });
      const child = Number(readFileSync(pidFile, "utf8"));
      await until("the hung test's child to die", 5_000, () => !alive(child));
    },
  );

  // Task 001-367, review 001-429 B2: a `squeal stop` stops the running batch and starts no queued one.
  it(
    "stops the running batch on a stop's signal and starts none of the queue",
    SLOW,
    async (ctx) => {
      const pidFile = join(scratch, "stop-hang.pid");
      const project = { ...PROJECT, env: { FIXTURE_HANG_PID_FILE: pidFile } };
      const stop = new AbortController();
      const logDir = join(scratch, `logs-stop-${runs}`);
      const running = run(ctx, refs("outcomes/test_hang.py", "outcomes/test_pass.py"), {
        project,
        batchSize: 1,
        concurrency: 1,
        logDir: logDir as AbsolutePath,
        signal: stop.signal,
      });
      await until("the hung test's child", 30_000, () => existsSync(pidFile));
      const stopped = performance.now();
      stop.abort();
      const { report } = await running;
      expect(performance.now() - stopped).toBeLessThan(2_000 + 5_000);
      expect(report).toMatchObject({ end: "completed", failure: null, completedFiles: [] });
      expect(existsSync(join(logDir, "stdout-1.log"))).toBe(false);
      const child = Number(readFileSync(pidFile, "utf8"));
      await until("the hung test's child to die", 5_000, () => !alive(child));
    },
  );

  it("starts nothing under a stop's signal already aborted", SLOW, async (ctx) => {
    const { report, logDir } = await run(ctx, refs("outcomes/test_pass.py"), {
      signal: AbortSignal.abort(),
    });
    expect(report).toMatchObject({
      end: "completed",
      failure: null,
      completedFiles: [],
      results: [],
    });
    expect(existsSync(join(logDir, "stdout-0.log"))).toBe(false);
  });

  it("runs batches of the policy size, a slow file alone", SLOW, async (ctx) => {
    const files = refs("outcomes/test_pass.py", "outcomes/test_fail.py", "outcomes/test_phases.py");
    const { report, logDir } = await run(ctx, files, {
      batchSize: 2,
      alone: (f) => f.path === "outcomes/test_fail.py",
      concurrency: 2,
    });
    expect(report.completedFiles).toEqual(
      refs("outcomes/test_fail.py", "outcomes/test_pass.py", "outcomes/test_phases.py"),
    );
    const log = JSON.parse(readFileSync(join(logDir, "run.json"), "utf8"));
    expect(log.batches.map((b: { files: string[] }) => b.files)).toEqual([
      ["outcomes/test_fail.py"],
      ["outcomes/test_pass.py", "outcomes/test_phases.py"],
    ]);
    // Row 011-164: each batch's command line and exit stay; the report keeps its summary only.
    expect(log.batches[0].command.length).toBeGreaterThan(1);
    expect(log.batches[0].exit).toMatchObject({ code: 1 });
    expect(log.report).toEqual(JSON.parse(JSON.stringify(runSummary(report))));
  });

  it(
    "refuses --lf in PYTEST_ADDOPTS before running, and in pytest's options when files miss it",
    SLOW,
    async (ctx) => {
      const env = { ...PROJECT, env: { PYTEST_ADDOPTS: "--lf" } };
      const fromFiles = await run(ctx, refs("outcomes/test_pass.py"), { project: env });
      expect(fromFiles.report).toMatchObject({ end: "crashed", completedFiles: [] });
      expect(fromFiles.report.failure).toContain("--lf (in PYTEST_ADDOPTS)");
      expect(existsSync(join(fromFiles.logDir, "events-0.jsonl"))).toBe(false);

      const hidden = { ...PROJECT, args: ["-o", "addopts=--lf"] };
      const fromPytest = await run(ctx, refs("outcomes/test_pass.py"), { project: hidden });
      expect(fromPytest.report).toMatchObject({ end: "crashed", completedFiles: [] });
      expect(fromPytest.report.failure).toContain("--lf (in pytest's resolved options)");
      expect(fromPytest.notes).toEqual([fromPytest.report.failure]);
    },
  );

  it(
    "observes each small test file's closure in a batch as in a run of that file alone",
    SLOW,
    async (ctx) => {
      const files = refs(
        "tests/test_entry_plugin.py",
        "tests/test_resources.py",
        "tests/unit/test_core.py",
      );
      const batch = await run(ctx, files);
      expect(batch.report.completedFiles).toEqual(files);
      for (const file of files) {
        const alone = await run(ctx, [file]);
        expect(batch.observed.find((o) => o.testFile.path === file.path)?.paths).toEqual(
          alone.observed[0]?.paths,
        );
      }
      const core = batch.observed.find((o) => o.testFile.path === "tests/unit/test_core.py");
      expect(core?.paths).toEqual(
        expect.arrayContaining([
          "packages/other/src/acme/ns/mod.py",
          "src/app/core.py",
          "src/app/dunder_literal.py",
          "src/app/lazy.py",
          "src/app/plugins/alpha.py",
          "tests/__init__.py",
          "tests/conftest.py",
          "tests/plugins/extra.py",
          "tests/unit/__init__.py",
          "tests/unit/conftest.py",
        ]),
      );
      expect(core?.paths).not.toContain("tests/test_resources.py");
      expect(batch.session).toContain("packages/other/src/other/plugin.py");
    },
  );

  it(
    "notes a run that skipped every collected test, and no other (review 007-16 S1)",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const path = join(fixture.root, "outcomes", "test_all_skipped.py");
      const exit = join(fixture.root, "outcomes", "test_exit.py");
      writeFileSync(
        path,
        [
          "import pytest",
          "",
          "@pytest.mark.skip(reason='on purpose')",
          "def test_skipped():",
          "    pass",
          "",
          "@pytest.mark.xfail(reason='expected')",
          "def test_xfail():",
          "    assert False",
          "",
        ].join("\n"),
      );
      try {
        const skipped = await run(ctx, refs("outcomes/test_all_skipped.py"));
        expect(outcomes(skipped.report.results)).toEqual({
          test_skipped: "skip",
          test_xfail: "skip",
        });
        expect(skipped.notes).toEqual([
          'pytest project "small" skipped every collected test (2 skipped) in its one file; pytest exits 0 then, so check what skips them (a missing setting or service often does).',
        ]);
        const mixed = await run(ctx, refs("outcomes/test_all_skipped.py", "outcomes/test_pass.py"));
        expect(mixed.notes).toEqual([]);
        // Review 007-21 S1: a later file of the batch that ends the process makes the tier
        // incomplete; the earlier skips stay, and no note claims every test skipped.
        writeFileSync(exit, "import os\n\ndef test_exit():\n    os._exit(2)\n");
        const partial = await run(
          ctx,
          refs("outcomes/test_all_skipped.py", "outcomes/test_exit.py"),
        );
        expect(partial.report.completedFiles).toEqual(refs("outcomes/test_all_skipped.py"));
        expect(outcomes(partial.report.results)).toEqual({
          test_skipped: "skip",
          test_xfail: "skip",
        });
        expect(partial.report.failure).toContain("outcomes/test_exit.py");
        expect(partial.notes).toEqual([]);
      } finally {
        rmSync(path);
        rmSync(exit, { force: true });
      }
    },
  );

  it(
    "runs a project without a config the same whatever config or conftest sits above it (review 007-16 B1)",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const pyproject = join(fixture.root, "pyproject.toml");
      const parked = `${pyproject}.parked`;
      const above = resolve(fixture.root, "..");
      const test = join(fixture.root, "outcomes", "test_no_config.py");
      renameSync(pyproject, parked);
      writeFileSync(join(above, "parent_only.py"), "");
      writeFileSync(
        join(above, "conftest.py"),
        "raise RuntimeError('an ancestor conftest loaded')\n",
      );
      writeFileSync(
        test,
        [
          "import importlib.util",
          "",
          "def test_no_parent_pythonpath():",
          "    assert importlib.util.find_spec('parent_only') is None",
          "",
        ].join("\n"),
      );
      try {
        const ini = join(above, "pytest.ini");
        const runs = [];
        for (const text of ["[pytest]\naddopts = -k nonexistent\npythonpath = .\n", "[pytest]\n"]) {
          writeFileSync(ini, text);
          const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
          const environment = await readEnvironment(
            realpathSync(fixture.root) as AbsolutePath,
            PROJECT,
            source,
          );
          expect(environment).toMatchObject({ state: "ready", config: null });
          const { report } = await run(
            ctx,
            refs("outcomes/test_no_config.py", "outcomes/test_pass.py"),
          );
          runs.push({ hash: environment.state === "ready" ? environment.hash : "", report });
        }
        for (const { report } of runs) {
          expect(report).toMatchObject({ end: "completed", failure: null });
          expect(outcomes(report.results)).toEqual({
            test_no_parent_pythonpath: "pass",
            test_passes: "pass",
          });
        }
        expect(runs[0]?.hash).toBe(runs[1]?.hash);
      } finally {
        renameSync(parked, pyproject);
        for (const name of ["pytest.ini", "conftest.py", "parent_only.py"])
          rmSync(join(above, name), { force: true });
        rmSync(test, { force: true });
      }
    },
  );

  it("overrides -x and -n 2 in addopts", SLOW, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    execFileSync("uv", ["pip", "install", "--python", fixture.python, "pytest-xdist==3.8.0"], {
      env: pythonEnv(),
      stdio: "ignore",
    });
    const pyproject = join(fixture.root, "pyproject.toml");
    const original = readFileSync(pyproject, "utf8");
    writeFileSync(pyproject, original.replace('addopts = "-q"', 'addopts = "-q -x -n 2"'));
    try {
      const files = refs("outcomes/test_fail.py", "outcomes/test_pass.py");
      const { report } = await run(ctx, files);
      expect(report.completedFiles).toEqual(files);
      expect(outcomes(report.results)).toEqual({
        test_passes_beside_the_failure: "pass",
        test_fails: "fail",
        test_passes: "pass",
      });
    } finally {
      writeFileSync(pyproject, original);
    }
  });

  it("leaves no bytecode and no pytest cache in the worktree", SLOW, async (ctx) => {
    const { root } = await run(ctx, refs("tests/unit/test_core.py", "outcomes/test_pass.py"));
    expect(artefacts(root)).toEqual([]);
    // The environment's bytecode is shared across runs, the worktree's never (007-29).
    const cached = readdirSync(join(scratch, "cache", "pycache"), { recursive: true }).map(String);
    const tag = `cpython-${version.replace(".", "")}`;
    expect(cached.some((name) => name.endsWith(`_pytest/python.${tag}.pyc`))).toBe(true);
    expect(cached.some((name) => name.endsWith(`core.${tag}.pyc`))).toBe(false);
  });
});
