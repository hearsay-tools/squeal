import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D2, execution: a slow file runs in a lane of its own,
 * `"slow:" + the runner's lane`, so an edit's fast tier runs beside a slow
 * file in flight (task 004-18); a slow file starts only when no edit's tier
 * is (D2 as amended, task 004-34). The harness holds a run before the Vitest adapter's queue
 * (`runnerPartBesideRun`), as the slow lane's own instance would let it.
 * In the `basic` fixture `test/strings.test.ts` imports `src/strings.ts`;
 * `test/math.test.ts` imports `src/math.ts`.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open() {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-18-slot-"));
  slotDirs.push(slotDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    runnerPartBesideRun: true,
  });
  return { h, store };
}

/** Holds every run of `path` until `release`; `held` counts the runs waiting. */
function hold(h: Harness, path: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: 0, release: () => release() };
  onTestFinished(() => release());
  const before = h.runner.beforeRun;
  h.runner.beforeRun = async (files) => {
    await before?.(files);
    if (!files.some((f) => f.path === path)) return;
    state.held += 1;
    await gate;
    state.held -= 1;
  };
  return state;
}

const lanesOf = (h: Harness, path: string) =>
  h.runsOf(path).map((run) => (run.options as { lane?: string }).lane);

describe("the slow lane (spec 004 D2, task 004-18)", SLOW, () => {
  it("reports an edit's fast file while a slow file is running", async () => {
    const { h, store } = await open();
    const slow = hold(h, STRINGS);
    await h.scheduler.start();
    await expect.poll(() => slow.held, { timeout: 60_000 }).toBe(1);
    const before = h.runsOf(MATH).length;

    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 1;\n");
    await h.batch("src/math.ts");
    const outcome = () =>
      store.knownStates
        .list(h.worktreeId)
        .find((s) => s.check.testPath === MATH && s.check.kind === "test")?.outcome;
    await expect.poll(outcome, { timeout: 60_000 }).toBe("fail");
    expect(h.runsOf(MATH).length).toBeGreaterThan(before);
    expect(slow.held).toBe(1);
    expect(h.runsOf(STRINGS)).toEqual([]);

    slow.release();
    await h.scheduler.idle();
    expect(h.runsOf(STRINGS)).toHaveLength(1);
    expect(lanesOf(h, STRINGS)).toEqual(["slow:"]);
    expect(new Set(lanesOf(h, MATH))).toEqual(new Set([""]));
  });

  it("starts no slow file while an edit's fast tier is in flight (D2's start rule)", async () => {
    const { h } = await open();
    const { delivery, consumer } = await h.consumer();
    await delivery.startTurn(consumer);
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.runsOf(STRINGS)).toEqual([]);

    const fast = hold(h, MATH);
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 1;\n");
    await h.batch("src/math.ts");
    await expect.poll(() => fast.held, { timeout: 60_000 }).toBe(1);
    await delivery.endTurn(consumer);
    // Several rechecks of the slow tier (`recheckMs` 50) while the fast tier is held.
    await delay(500);
    expect(h.runsOf(STRINGS)).toEqual([]);
    fast.release();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
  });

  it("releases the slow lane once its pass drains", async () => {
    const { h } = await open();
    const released: { lane: string; slowRuns: number }[] = [];
    h.runner.releaseLane = async (lane) => {
      released.push({ lane, slowRuns: h.runsOf(STRINGS).length });
    };
    await h.scheduler.start();
    await expect.poll(() => released.length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    expect(released).toEqual([{ lane: "slow:", slowRuns: 1 }]);
  });
});
