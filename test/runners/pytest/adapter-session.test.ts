import { readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * Review wave 2, B5, on a uv-synced copy of the small fixture: what a
 * start-up plugin (`pytest11` or `-p`) imports by a computed name is no
 * static closure's, so the run reports it as `environmentObserved`. The
 * core stores it per project, joins it to the environment's key and reads
 * what other worktrees stored (spec 016 D4); the adapter keeps none of it.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const ENTRY_TEST = "tests/test_entry_plugin.py";
const CORE_TEST = "tests/unit/test_core.py";
const PLUGIN = "packages/other/src/other/plugin.py";
const HIDDEN = "packages/other/src/other/hidden.py";
const STARTUP = "src/app/startup.py";
const STARTUP_HIDDEN = "src/app/startup_hidden.py";
const ref = (path: string): TestFileRef => ({ project: "small", path });

const DYNAMIC_PLUGIN = `import importlib
import pytest
name = "other." + "hidden"
hidden = importlib.import_module(name)
@pytest.fixture
def other_fixture():
    return hidden.VALUE
`;

describe.each(PYTHONS)("pytest adapter start-up observations under Python %s (B5)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  const adapters: RunnerAdapter[] = [];
  beforeAll(() => {
    synced = syncFixture(small, version);
  }, 300_000);
  afterAll(async () => {
    await Promise.all(adapters.map((a) => a.close()));
    if (synced.ok) synced.env.cleanup();
  });

  let runs = 0;
  const runOptions = (root: string): RunOptions => ({
    runId: `r${runs}`,
    logDir: join(root, "..", `logs-${runs++}`),
    timeoutMs: 60_000,
  });
  const open = async (ctx: Parameters<typeof requireSynced>[0], project: PytestProject) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const adapter = await createPytestAdapter(project, {
      root,
      source: fixture.env,
      cacheDir: join(root, "..", "cache") as AbsolutePath,
    });
    adapters.push(adapter);
    return { adapter, root };
  };
  /** Writes `files` into the synced copy for the test, restoring what was there. */
  const withFiles = async (
    ctx: Parameters<typeof requireSynced>[0],
    files: Record<string, string>,
    body: () => Promise<void>,
  ) => {
    const root = requireSynced(ctx, synced).root;
    const before = Object.keys(files).map((path) => {
      try {
        return [path, readFileSync(join(root, path), "utf8")] as const;
      } catch {
        return [path, null] as const;
      }
    });
    for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
    try {
      await body();
    } finally {
      for (const [path, text] of before) {
        if (text === null) rmSync(join(root, path), { force: true });
        else writeFileSync(join(root, path), text);
      }
    }
  };

  it(
    "a pytest11 plugin's dynamic import is reported as a start-up path, for the core to key",
    SLOW,
    async (ctx) => {
      const project = { name: "small", args: [], env: {}, include: [ENTRY_TEST] };
      await withFiles(ctx, { [PLUGIN]: DYNAMIC_PLUGIN, [HIDDEN]: "VALUE = 2\n" }, async () => {
        const { adapter, root } = await open(ctx, project);
        expect((await adapter.environment())[0]?.observedLoads).toBe(true);
        expect((await adapter.environment())[0]?.files).toContain(PLUGIN);
        expect((await adapter.environment())[0]?.files).not.toContain(HIDDEN);

        const report = await adapter.run([ref(ENTRY_TEST)], runOptions(root));
        expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
          ["test_entry_plugin", "pass"],
        ]);
        expect(report.environmentObserved).toEqual([{ project: "small", paths: [HIDDEN] }]);
        // The core joins it to the environment's key; the adapter's files stay its own.
        expect((await adapter.environment())[0]?.files).not.toContain(HIDDEN);
        expect(await adapter.invalidate([{ path: HIDDEN, kind: "change" }])).toEqual({
          recreatedProjects: [],
        });
      });
    },
  );

  it(
    "a conftest and the test packages it loads at collection are its files', not the session's (007-36)",
    SLOW,
    async (ctx) => {
      const include = [CORE_TEST, "tests/test_resources.py"];
      const { adapter, root } = await open(ctx, {
        name: "small",
        args: [],
        env: {},
        include,
      });
      const report = await adapter.run(include.map(ref), runOptions(root));
      expect(report.completedFiles).toEqual(include.map(ref));
      expect(report.environmentObserved).toBeUndefined();
      const files = (await adapter.environment())[0]?.files ?? [];
      expect(files.filter((p) => p.startsWith("tests/"))).toEqual([]);
      // D5: the nested conftest and its package affect the files below them only.
      for (const path of ["tests/unit/conftest.py", "tests/unit/__init__.py"]) {
        const { direct, transitive } = await adapter.affected([path]);
        expect([...direct, ...transitive].map((f) => f.path)).toEqual([CORE_TEST]);
      }
    },
  );

  it(
    "a module a conftest loads through a library is that conftest's files', not the session's (007-36)",
    SLOW,
    async (ctx) => {
      // As briefcase's modules load platforms through entry points while its root conftest imports them.
      const version = `import pkgutil\nLOADED = pkgutil.resolve_name("app.startup_hidden")\nVERSION = "0.1.0"\n`;
      const include = [CORE_TEST, "tests/test_resources.py"];
      await withFiles(
        ctx,
        { "src/app/version.py": version, [STARTUP_HIDDEN]: "X = 1\n" },
        async () => {
          const { adapter, root } = await open(ctx, {
            name: "small",
            args: [],
            env: {},
            include,
          });
          const report = await adapter.run(include.map(ref), runOptions(root));
          expect(report.completedFiles).toEqual(include.map(ref));
          expect(report.environmentObserved).toBeUndefined();
          for (const file of include) {
            const seen = report.observed?.find((o) => o.testFile.path === file);
            expect(seen?.paths).toContain(STARTUP_HIDDEN);
          }
        },
      );
    },
  );

  it(
    "a batch closes its events file: no ResourceWarning in its stderr (007-36)",
    SLOW,
    async (ctx) => {
      const include = [CORE_TEST, "tests/test_resources.py"];
      // Python's own filters hide a ResourceWarning; a project's may show it (briefcase's did).
      const { adapter, root } = await open(ctx, {
        name: "small",
        args: [],
        env: { PYTHONWARNINGS: "error::ResourceWarning" },
        include,
      });
      const options = runOptions(root);
      const report = await adapter.run(include.map(ref), options);
      expect(report.completedFiles).toEqual(include.map(ref));
      const logs = join(options.logDir, "pytest", "small");
      const stderr = readdirSync(logs).filter((f) => f.startsWith("stderr-"));
      expect(stderr.length).toBeGreaterThan(0);
      for (const file of stderr) {
        expect(readFileSync(join(logs, file), "utf8")).not.toContain("ResourceWarning");
      }
    },
  );

  it("a -p plugin's dynamic import is observed the same way", SLOW, async (ctx) => {
    const project = { name: "small", args: ["-p", "app.startup"], env: {}, include: [CORE_TEST] };
    const startup = `import importlib\nimportlib.import_module("app." + "startup_hidden")\n`;
    await withFiles(ctx, { [STARTUP]: startup, [STARTUP_HIDDEN]: "X = 1\n" }, async () => {
      const { adapter, root } = await open(ctx, project);
      expect((await adapter.environment())[0]?.files).toContain(STARTUP);
      const report = await adapter.run([ref(CORE_TEST)], runOptions(root));
      expect(report.completedFiles).toEqual([ref(CORE_TEST)]);
      const startup = report.environmentObserved?.[0]?.paths ?? [];
      expect(startup).toContain(STARTUP_HIDDEN);
      // Nothing under the environment directory: its fingerprint covers those.
      expect(startup.some((p) => p.startsWith(".venv/"))).toBe(false);
    });
  });
});
