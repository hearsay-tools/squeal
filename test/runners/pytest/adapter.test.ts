import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AbsolutePath,
  PytestProject,
  RunnerAdapter,
  RunOptions,
  TestFileRef,
} from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";

/*
 * Spec 007 D2 to D7 assembled behind `RunnerAdapter`: `createPytestAdapter`
 * over a uv-synced copy of the small fixture. The environment's states key
 * and run as D2 says, the graph keys without one (D4 as amended), a run
 * reports its observed-only path, which the core keys (D4, spec 016 D4),
 * and the bytecode and cache land in the cache directory, never the tree.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const TEST_FILES = [
  "tests/test_entry_plugin.py",
  "tests/test_resources.py",
  "tests/unit/test_core.py",
];
const CORE_TEST = "tests/unit/test_core.py";
const OBSERVED_ONLY = "src/app/plugins/alpha.py";

const ref = (path: string): TestFileRef => ({ project: "small", path });

/** Every `__pycache__` and `.pytest_cache` under `dir`, `.venv` left out. */
function artefacts(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (!entry.isDirectory() || entry.name === ".venv") return [];
    if (entry.name === "__pycache__" || entry.name === ".pytest_cache") return [path];
    return artefacts(dir, path);
  });
}

describe.each(PYTHONS)("createPytestAdapter under Python %s (spec 007)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  const adapters: RunnerAdapter[] = [];
  beforeAll(() => {
    synced = syncFixture(small, version);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-adapter-")));
  }, 300_000);
  afterAll(async () => {
    await Promise.all(adapters.map((a) => a.close()));
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  });

  let runs = 0;
  const runOptions = (): RunOptions => ({
    runId: `r${runs}`,
    logDir: join(scratch, `logs-${runs++}`),
    timeoutMs: 60_000,
  });
  const open = async (
    ctx: Parameters<typeof requireSynced>[0],
    project: PytestProject = PROJECT,
  ) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
    const notes: string[] = [];
    const adapter = await createPytestAdapter(project, {
      root,
      source,
      note: (text) => notes.push(text),
      cacheDir: join(scratch, "cache") as AbsolutePath,
    });
    adapters.push(adapter);
    return { adapter, root, notes };
  };

  it(
    "runs the project and reports an observed-only path, outside the file's closure",
    SLOW,
    async (ctx) => {
      const { adapter, root } = await open(ctx);
      expect((await adapter.testFiles()).map((f) => f.path)).toEqual(TEST_FILES);
      const [environment] = await adapter.environment();
      expect(environment).toMatchObject({ project: "small", runnerName: "pytest" });
      expect(environment?.runnerVersion).toMatch(/^\d+\.\d+/);
      expect(environment?.files).toContain(".venv/pyvenv.cfg");
      expect(environment?.files).toContain("pyproject.toml");
      // Task 007-28: uv hardlinks site-packages from its cache where it can (CI's ext4), so
      // a sync or a removal anywhere moves their ctime; none of them, pytest's own or a
      // third-party plugin's, is a watched file or a closure path. `pyvenv.cfg` is the
      // environment's own, which uv writes.
      const site = `.venv/lib/python${version}/site-packages`;
      const shared = [`${site}/pytest/__init__.py`, `${site}/pytest_mock/plugin.py`];
      for (const path of shared) expect(existsSync(join(root, path))).toBe(true);
      expect(environment?.files.filter((p) => p.startsWith(".venv/"))).toEqual([
        ".venv/pyvenv.cfg",
      ]);
      for (const file of TEST_FILES) {
        const { paths } = await adapter.closure(ref(file));
        expect(paths.filter((p) => p.startsWith(".venv/"))).toEqual([]);
      }
      // D2: the `pytest11` plugin of the workspace member is in the environment.
      expect(environment?.files).toContain("packages/other/src/other/plugin.py");
      expect((await adapter.closure(ref(CORE_TEST))).paths).not.toContain(OBSERVED_ONLY);
      expect(await adapter.enumerate(ref(CORE_TEST))).toContainEqual(
        expect.objectContaining({ check: expect.objectContaining({ fullName: "test_computed" }) }),
      );

      const report = await adapter.run(TEST_FILES.map(ref), runOptions());
      expect(report).toMatchObject({ end: "completed", failure: null, fileErrors: [] });
      expect(report.completedFiles.map((f) => f.path)).toEqual(TEST_FILES);
      expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
      expect(report.results.map((r) => r.check.fullName)).toContain("test_total[xs0-6]");

      // D4: the computed `import_module` loaded what no static closure holds; the
      // core keys it (spec 016 D4), so the adapter's closure stays the graph's.
      const core = report.observed?.find((o) => o.testFile.path === CORE_TEST);
      expect(core?.paths).toContain(OBSERVED_ONLY);
      expect(report.observed?.flatMap((o) => o.paths).some((p) => p.startsWith(".venv/"))).toBe(
        false,
      );
      expect((await adapter.closure(ref(CORE_TEST))).paths).not.toContain(OBSERVED_ONLY);
      expect((await adapter.affected([OBSERVED_ONLY])).transitive).toEqual([]);
      expect(artefacts(root)).toEqual([]);
      expect(existsSync(join(scratch, "cache", "pycache"))).toBe(true);
    },
  );

  it("an edit affects exactly the files importing it", SLOW, async (ctx) => {
    const { adapter } = await open(ctx);
    expect(await adapter.affected(["src/app/version.py"])).toEqual({
      direct: [],
      transitive: TEST_FILES.map(ref),
    });
    expect((await adapter.affected(["src/app/resources.py"])).direct).toEqual([
      ref("tests/test_resources.py"),
    ]);
  });

  it(
    "without .venv keys unavailable with D2's note, and recreates once the environment exists",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const venv = join(fixture.root, ".venv");
      renameSync(venv, `${venv}-aside`);
      try {
        const { adapter, notes } = await open(ctx);
        const [environment] = await adapter.environment();
        expect(environment?.runnerVersion).toBe("unavailable");
        expect(notes).toContainEqual(expect.stringMatching(/no Python environment.*uv sync/));
        // D4 as amended: closures work without an environment.
        expect((await adapter.closure(ref(CORE_TEST))).paths).toContain("src/app/core.py");
        const report = await adapter.run([ref(CORE_TEST)], runOptions());
        expect(report).toMatchObject({ end: "crashed", completedFiles: [] });
        expect(report.failure).toMatch(/no Python environment/);

        renameSync(`${venv}-aside`, venv);
        const changed = await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "add" }]);
        expect(changed.recreatedProjects).toEqual(["small"]);
        const [ready] = await adapter.environment();
        expect(ready?.runnerVersion).not.toBe("unavailable");
        expect(notes).toContainEqual(expect.stringMatching(/environment is ready/));
        const after = await adapter.run([ref(CORE_TEST)], runOptions());
        expect(after.completedFiles).toEqual([ref(CORE_TEST)]);
        expect(await adapter.invalidate([{ path: "src/app/core.py", kind: "change" }])).toEqual({
          recreatedProjects: [],
        });
      } finally {
        if (!existsSync(venv)) renameSync(`${venv}-aside`, venv);
      }
    },
  );

  it("a pytest config change recreates the project", SLOW, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const { adapter } = await open(ctx);
    const before = (await adapter.environment())[0]?.resolvedConfig;
    const pyproject = join(fixture.root, "pyproject.toml");
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(pyproject, "utf8");
    writeFileSync(
      pyproject,
      text.replace('addopts = "-q"', 'addopts = "-q --import-mode=importlib"'),
    );
    try {
      const changed = await adapter.invalidate([{ path: "pyproject.toml", kind: "change" }]);
      expect(changed.recreatedProjects).toEqual(["small"]);
      expect((await adapter.environment())[0]?.resolvedConfig).not.toBe(before);
    } finally {
      writeFileSync(pyproject, text);
    }
  });

  it(
    "skips a skipped module's known checks and passes on a collection error (D6)",
    SLOW,
    async (ctx) => {
      const outcomes = {
        ...PROJECT,
        include: ["outcomes/test_*.py"],
        exclude: ["outcomes/test_hang.py"],
      };
      const { adapter } = await open(ctx, outcomes);
      const files = [ref("outcomes/test_collection_error.py"), ref("outcomes/test_module_skip.py")];
      const report = await adapter.run(files, runOptions());
      expect(report.completedFiles).toEqual(files);
      expect(report.results).toMatchObject([
        {
          check: { testPath: "outcomes/test_module_skip.py", fullName: "test_never_run" },
          outcome: "skip",
        },
      ]);
      expect(report.fileErrors).toMatchObject([
        {
          testFile: ref("outcomes/test_collection_error.py"),
          errors: [{ name: "ModuleNotFoundError" }],
        },
      ]);
    },
  );
});
