import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AbsolutePath,
  PytestProject,
  RunnerAdapter,
  RunOptions,
  TestFileRef,
} from "../../../src/core/types/index.js";
import { createPytestAdapter, type ObservedStore } from "../../../src/runners/pytest/adapter.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";

/*
 * Review wave 2, B5, on a uv-synced copy of the small fixture: what a
 * start-up plugin (`pytest11` or `-p`) imports by a computed name is no
 * static closure's, so the run's session observation is stored in the
 * project's shared key, joins the environment's files and is reported as
 * `environmentObserved`; another worktree's adapter keys it from the store
 * before running anything, and growth it finds there re-keys the project.
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

/** The daemon's session key, in memory, shared by two adapters as by two worktrees. */
function memoryStore(): ObservedStore & { session: string[] } {
  const session: string[] = [];
  return {
    session,
    read: () => ({}),
    write: () => {},
    readSession: () => session,
    writeSession(additions) {
      for (const path of additions) if (!session.includes(path)) session.push(path);
      session.sort();
    },
  };
}

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
  const open = async (
    ctx: Parameters<typeof requireSynced>[0],
    store: ObservedStore,
    project: PytestProject,
  ) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const adapter = await createPytestAdapter(project, {
      root,
      source: fixture.env,
      observed: store,
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
    "a pytest11 plugin's dynamic import joins the environment, the shared key and the report",
    SLOW,
    async (ctx) => {
      const project = { name: "small", args: [], env: {}, include: [ENTRY_TEST] };
      await withFiles(ctx, { [PLUGIN]: DYNAMIC_PLUGIN, [HIDDEN]: "VALUE = 2\n" }, async () => {
        const store = memoryStore();
        const { adapter, root } = await open(ctx, store, project);
        // Another worktree's daemon, open before the first run.
        const other = await open(ctx, store, project);
        expect((await adapter.environment())[0]?.files).toContain(PLUGIN);
        expect((await adapter.environment())[0]?.files).not.toContain(HIDDEN);

        const report = await adapter.run([ref(ENTRY_TEST)], runOptions(root));
        expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
          ["test_entry_plugin", "pass"],
        ]);
        expect(report.environmentObserved).toEqual([{ project: "small", paths: [HIDDEN] }]);
        expect(store.session).toEqual([HIDDEN]);
        expect((await adapter.environment())[0]?.files).toContain(HIDDEN);
        // Keyed now, so the next run reports it again but its edit is the environment's.
        expect(await adapter.invalidate([{ path: HIDDEN, kind: "change" }])).toEqual({
          recreatedProjects: [],
        });

        // The other worktree finds the growth at its next refinement and re-keys the project.
        expect(await other.adapter.invalidate([{ path: "README.md", kind: "change" }])).toEqual({
          recreatedProjects: ["small"],
        });
        expect((await other.adapter.environment())[0]?.files).toContain(HIDDEN);
        // A worktree started after it keys the path before any run.
        const third = await open(ctx, store, project);
        expect((await third.adapter.environment())[0]?.files).toContain(HIDDEN);
      });
    },
  );

  it("a -p plugin's dynamic import is observed the same way", SLOW, async (ctx) => {
    const project = { name: "small", args: ["-p", "app.startup"], env: {}, include: [CORE_TEST] };
    const startup = `import importlib\nimportlib.import_module("app." + "startup_hidden")\n`;
    await withFiles(ctx, { [STARTUP]: startup, [STARTUP_HIDDEN]: "X = 1\n" }, async () => {
      const store = memoryStore();
      const { adapter, root } = await open(ctx, store, project);
      expect((await adapter.environment())[0]?.files).toContain(STARTUP);
      const report = await adapter.run([ref(CORE_TEST)], runOptions(root));
      expect(report.completedFiles).toEqual([ref(CORE_TEST)]);
      expect(report.environmentObserved?.[0]?.paths).toContain(STARTUP_HIDDEN);
      expect(store.session).toContain(STARTUP_HIDDEN);
      expect((await adapter.environment())[0]?.files).toContain(STARTUP_HIDDEN);
      // Nothing under the environment directory: its fingerprint covers those.
      expect(store.session.some((p) => p.startsWith(".venv/"))).toBe(false);
    });
  });
});
