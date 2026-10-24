import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type KnownState } from "../../src/core/types/index.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Row 011-159 (001 D11 and 011 C4 step 3 as amended 2026-10-23): with no
 * `baseline` key a new worktree's start queues no miss, and a file whose
 * result at its key is another worktree's fail (001 D6, task 001-170) is
 * still queued once and run, so its local result confirms or clears it. On
 * 2026-10-23 cezar held 30 such failing rows under `lookup-only` that no run
 * confirmed (`research/main-daemon.md` 5). The later lookup's case is
 * `adoption.test.ts` 2.
 */

const COUNT = 4;
const all = Array.from({ length: COUNT }, (_, i) => fileName(i));
const F0 = fileName(0);
/** The policy the loader gives a `squeal.config.json` with no `baseline` key. */
const NO_BASELINE_KEY = { baseline: DEFAULT_POLICY.baseline };
const RUN_MISSING = { baseline: { onStart: "lookup-then-run-missing" as const } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 60_000 } as const;

/** `s`'s test state of `path`. */
function stateOf(s: Side, path: string): KnownState | undefined {
  return s.store.knownStates
    .list(s.worktreeId)
    .find((state) => state.check.kind === "test" && state.check.testPath === path);
}

/** The paths `s`'s runner ran, in order. */
const ran = (s: Side) => s.runner.runs.flat().map((file) => file.path);

/** A reconciliation pass that found no change, as the change feed's every 30 s. */
const pass = (s: Side) => s.scheduler.handleBatch({ trigger: "interval", paths: [] });

/** The main checkout's `run --all` stored a pass for every file but `F0`, which failed. */
async function storedByMain() {
  const { main, other } = claimRepo(COUNT);
  const a = side(main, { count: COUNT, policy: NO_BASELINE_KEY, rerunCap: 0 });
  a.runner.failing.add(F0);
  await a.scheduler.start();
  await a.scheduler.idle();
  expect(a.runner.runs).toEqual([]);
  await a.scheduler.requestFullSuite();
  await a.scheduler.idle();
  expect(stateOf(a, F0)).toMatchObject({ outcome: "fail", validity: "current" });
  return { a, other };
}

describe("lookup-only by default, and a held inherited fail runs once (011-159)", SLOW, () => {
  it("with no baseline key, a new worktree's start queues no miss", async () => {
    expect(DEFAULT_POLICY.baseline.onStart).toBe("lookup-only");
    const { main } = claimRepo(COUNT);
    const a = side(main, { count: COUNT, policy: NO_BASELINE_KEY });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runs).toEqual([]);
    for (const path of all) expect(a.phase(path)).toBeNull();
  });

  it("at start, only the held fail runs, once, and the local fail confirms it", async () => {
    const { a, other } = await storedByMain();
    const b = side(other, { count: COUNT, policy: NO_BASELINE_KEY });
    b.runner.failing.add(F0);
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(ran(b)).toEqual([F0]);
    expect(b.passing()).toBe(COUNT - 1);
    expect(stateOf(b, F0)).toMatchObject({
      outcome: "fail",
      validity: "current",
      origin: { kind: "own" },
    });
    expect(stateOf(a, F0)).toMatchObject({ outcome: "fail", validity: "current" });

    // Confirmed: later passes run it no more.
    await pass(b);
    await b.scheduler.idle();
    expect(ran(b)).toEqual([F0]);
  });

  it("at start, a local pass clears the held fail and heals the worktree that stored it", async () => {
    const { a, other } = await storedByMain();
    const b = side(other, { count: COUNT, policy: NO_BASELINE_KEY });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(ran(b)).toEqual([F0]);
    expect(b.passing()).toBe(COUNT);
    expect(stateOf(b, F0)).toMatchObject({ outcome: "pass", origin: { kind: "own" } });
    expect(stateOf(a, F0)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("with lookup-then-run-missing set, the start runs every miss as before", async () => {
    const { main } = claimRepo(COUNT);
    const a = side(main, { count: COUNT, policy: RUN_MISSING });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(ran(a).sort()).toEqual(all);
    expect(a.passing()).toBe(COUNT);
  });
});
