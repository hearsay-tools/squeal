import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import {
  type Clock,
  SETTLE_LIMIT_MS,
  SETTLE_MS,
} from "../../../src/runners/pytest/adapter-environment.js";
import { sitePackagesDir } from "../../../src/runners/pytest/environment/site.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";

/*
 * Review wave 2, B1 and B2, on a uv-synced copy of the small fixture: the
 * adapter admits an environment only once its fingerprint held still for a
 * second (a controlled clock rewrites a `.pth` at every poll it should),
 * and `recheck`, which the scheduler calls at a quiet reconciliation pass
 * (task 007-26), finds an installed-set change no watched file shows.
 * Task 007-39 (lessons.md defect 8): an environment whose `pyvenv.cfg`
 * appears before pytest is installed is admitted once pytest lands, not
 * only at the interval recheck a minute later.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const ref = (path: string): TestFileRef => ({ project: "small", path });

/** A simulated clock; `onSleep` runs at each poll. */
function controlled(onSleep: () => void = () => {}): Clock & { elapsed: () => number } {
  let now = 0;
  return {
    now: () => now,
    elapsed: () => now,
    async sleep(ms) {
      now += ms;
      onSleep();
    },
  };
}

describe.each(PYTHONS)("pytest adapter admission under Python %s (B1, B2)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  const adapters: RunnerAdapter[] = [];
  beforeAll(() => {
    synced = syncFixture(small, version);
  }, 300_000);
  afterAll(async () => {
    await Promise.all(adapters.map((a) => a.close()));
    if (synced.ok) synced.env.cleanup();
  });

  const open = async (ctx: Parameters<typeof requireSynced>[0], clock: Clock) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const site = sitePackagesDir(join(root, ".venv") as AbsolutePath) as AbsolutePath;
    const notes: string[] = [];
    const adapter = await createPytestAdapter(PROJECT, {
      root,
      source: fixture.env,
      note: (text) => notes.push(text),
      cacheDir: join(root, "..", "cache") as AbsolutePath,
      clock,
    });
    adapters.push(adapter);
    return { adapter, root, site, notes };
  };
  let runs = 0;
  const runOptions = (root: string): RunOptions => ({
    runId: `r${runs}`,
    logDir: join(root, "..", `logs-${runs++}`),
    timeoutMs: 60_000,
  });

  it("at startup admits a still environment only after a second", SLOW, async (ctx) => {
    const clock = controlled();
    const { adapter } = await open(ctx, clock);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(SETTLE_MS);
    expect((await adapter.environment())[0]?.runnerVersion).toMatch(/^\d+\.\d+/);
  });

  it(
    "an environment changing through 20 s is unsettled, runs nothing, then is admitted once still",
    SLOW,
    async (ctx) => {
      let writing = true;
      let n = 0;
      const fixture = requireSynced(ctx, synced);
      const site = sitePackagesDir(join(fixture.root, ".venv") as AbsolutePath) as string;
      const pth = join(site, "review.pth");
      const clock = controlled(() => {
        if (writing) writeFileSync(pth, `# ${n++}\n`);
      });
      writeFileSync(pth, "# start\n");
      try {
        const { adapter, root, notes } = await open(ctx, clock);
        expect(clock.elapsed()).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
        const [environment] = await adapter.environment();
        expect(environment?.runnerVersion).toBe("unavailable");
        expect(environment?.resolvedConfig).toContain('"state":"unsettled"');
        const unsettled = notes.filter((t) => /kept changing for 20 s/.test(t));
        expect(unsettled).toHaveLength(1);
        const report = await adapter.run([ref("tests/unit/test_core.py")], runOptions(root));
        expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });

        // Still changing at the recheck: still unsettled, the note not repeated.
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
        expect(notes.filter((t) => /kept changing/.test(t))).toHaveLength(1);

        writing = false;
        const before = clock.elapsed();
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["small"] });
        expect(clock.elapsed() - before).toBeGreaterThanOrEqual(SETTLE_MS);
        expect((await adapter.environment())[0]?.runnerVersion).toMatch(/^\d+\.\d+/);
        expect(notes).toContainEqual(expect.stringMatching(/environment is ready/));
      } finally {
        rmSync(pth, { force: true });
      }
    },
  );

  it(
    "a ready environment that keeps changing at a batch is not admitted at the 20 s limit",
    SLOW,
    async (ctx) => {
      let writing = false;
      let n = 0;
      const fixture = requireSynced(ctx, synced);
      const site = sitePackagesDir(join(fixture.root, ".venv") as AbsolutePath) as string;
      const pth = join(site, "review.pth");
      const clock = controlled(() => {
        if (writing) writeFileSync(pth, `# ${n++}\n`);
      });
      try {
        const { adapter } = await open(ctx, clock);
        writing = true;
        writeFileSync(pth, "# start\n");
        const relative = `${site.slice(realpathSync(fixture.root).length + 1)}/review.pth`;
        const before = clock.elapsed();
        expect(await adapter.invalidate([{ path: relative, kind: "add" }])).toEqual({
          recreatedProjects: ["small"],
        });
        expect(clock.elapsed() - before).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
        expect((await adapter.environment())[0]?.runnerVersion).toBe("unavailable");
      } finally {
        rmSync(pth, { force: true });
      }
    },
  );

  it(
    "an environment that gains pytest after its pyvenv.cfg is admitted within 5 s (007-39)",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const venv = join(fixture.root, ".venv");
      const hidden = join(fixture.root, ".venv-hidden");
      const pytest = join(sitePackagesDir(venv as AbsolutePath) as string, "pytest");
      const aside = join(fixture.root, "..", "pytest-aside");
      let polls = 0;
      let installedAt: number | null = null;
      const clock = controlled(() => {
        // The sync installs pytest at the third look after pyvenv.cfg appeared.
        if (polls++ === 3 && installedAt === null) {
          renameSync(aside, pytest);
          installedAt = clock.now();
        }
      });
      renameSync(venv, hidden);
      try {
        const { adapter, notes } = await open(ctx, clock);
        expect((await adapter.environment())[0]?.resolvedConfig).toContain('"state":"none"');

        // The sync writes pyvenv.cfg, then its packages; pytest is not there yet.
        renameSync(hidden, venv);
        renameSync(pytest, aside);
        polls = 0;
        expect(await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "add" }])).toEqual({
          recreatedProjects: ["small"],
        });
        expect(installedAt).not.toBeNull();
        expect(clock.elapsed() - (installedAt ?? 0)).toBeLessThan(5_000);
        expect((await adapter.environment())[0]?.runnerVersion).toMatch(/^\d+\.\d+/);
        expect(notes).toContainEqual(expect.stringMatching(/environment is ready/));
        expect(notes.filter((t) => /pytest is not installed/.test(t))).toEqual([]);
      } finally {
        if (existsSync(hidden)) renameSync(hidden, venv);
        if (existsSync(aside)) renameSync(aside, pytest);
      }
    },
  );

  it(
    "an environment without pytest through 20 s is refused once with its note (007-39)",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const pytest = join(
        sitePackagesDir(join(fixture.root, ".venv") as AbsolutePath) as string,
        "pytest",
      );
      const aside = join(fixture.root, "..", "pytest-aside");
      renameSync(pytest, aside);
      try {
        const clock = controlled();
        const { adapter, root, notes } = await open(ctx, clock);
        expect(clock.elapsed()).toBeGreaterThanOrEqual(SETTLE_LIMIT_MS);
        expect((await adapter.environment())[0]?.resolvedConfig).toContain('"state":"no-pytest"');
        expect(notes.filter((t) => /pytest is not installed/.test(t))).toHaveLength(1);
        const report = await adapter.run([ref("tests/unit/test_core.py")], runOptions(root));
        expect(report).toMatchObject({ end: "crashed", completedFiles: [] });
        // Still without pytest: the recheck neither waits again nor re-keys.
        const before = clock.elapsed();
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
        expect(clock.elapsed()).toBe(before);
      } finally {
        renameSync(aside, pytest);
      }
    },
  );

  it(
    "a recheck finds an installed upgrade and a .pth change no watched file shows (B1)",
    SLOW,
    async (ctx) => {
      const clock = controlled();
      const { adapter, site } = await open(ctx, clock);
      const watched = new Set((await adapter.environment())[0]?.files);
      // A still environment: the recheck re-keys nothing and does not wait.
      const still = clock.elapsed();
      expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
      expect(clock.elapsed()).toBe(still);

      const v1 = join(site, "reviewdep-1.0.dist-info");
      const v2 = join(site, "reviewdep-2.0.dist-info");
      const pkg = join(site, "reviewdep");
      const pth = join(site, "reviewdep.pth");
      try {
        mkdirSync(pkg);
        writeFileSync(join(pkg, "__init__.py"), "VALUE = 1\n");
        mkdirSync(v1);
        writeFileSync(join(v1, "METADATA"), "Name: reviewdep\nVersion: 1.0\n");
        const first = (await adapter.environment())[0]?.resolvedConfig;
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["small"] });
        const installed = (await adapter.environment())[0]?.resolvedConfig;
        expect(installed).not.toBe(first);

        // The upgrade: no worktree source, config, pyvenv.cfg or pytest marker changes.
        rmSync(v1, { recursive: true });
        mkdirSync(v2);
        writeFileSync(join(v2, "METADATA"), "Name: reviewdep\nVersion: 2.0\n");
        writeFileSync(join(pkg, "__init__.py"), "VALUE = 2\n");
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["small"] });
        const upgraded = (await adapter.environment())[0]?.resolvedConfig;
        expect(upgraded).not.toBe(installed);

        writeFileSync(pth, "# one\n");
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["small"] });
        const added = (await adapter.environment())[0]?.resolvedConfig;
        writeFileSync(pth, "# two\n");
        expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["small"] });
        expect((await adapter.environment())[0]?.resolvedConfig).not.toBe(added);
        // An empty invalidate, the observed-paths refinement, reads the environment too.
        writeFileSync(pth, "# three\n");
        expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["small"] });
        // None of it was a watched file: only the recheck could see it.
        for (const path of [v1, v2, pkg, pth]) {
          expect([...watched].some((w) => path.endsWith(w))).toBe(false);
        }
      } finally {
        for (const path of [v1, v2, pkg, pth]) rmSync(path, { recursive: true, force: true });
        await adapter.recheck?.();
      }
    },
  );
});
