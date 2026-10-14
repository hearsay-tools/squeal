import { realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * and an empty `invalidate`, the scheduler's recheck at each
 * reconciliation pass, finds an installed-set change no watched file shows.
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
        expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
        expect(notes.filter((t) => /kept changing/.test(t))).toHaveLength(1);

        writing = false;
        const before = clock.elapsed();
        expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["small"] });
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
});
