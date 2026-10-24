import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { findPython, pythonEnv } from "../helpers/pytest-env.js";
import { createRepo, openHarness, openRepoStore } from "./helpers.js";
import { timedRunner } from "./timed-runner.js";

/*
 * Task 011-21 slice 2, done-when 5 (spec 011 C4 step 5 as amended for slots,
 * spec 007 D6): a pytest lane runs its backlog in slots of one batch each,
 * one process that runs its files in turn. A slot packs up to the batch size
 * of light files, last known at most 1 s; a heavy file runs alone. The small
 * fixture, synced with uv, plus 12 light files of 50 ms and 2 heavy ones of
 * 1.5 s, at W = 4 from a pool of 4: the forced pass after the baseline is
 * the backlog measured, in slots and, as before slots, in one tier.
 */
const SMALL = resolve(import.meta.dirname, "../fixtures/pytest/small");
const LIGHT = Array.from(
  { length: 12 },
  (_, i) => `tests/slots/test_l${String(i).padStart(2, "0")}.py`,
);
const HEAVY = ["tests/slots/test_h0.py", "tests/slots/test_h1.py"];
const FIXTURE = [
  "tests/test_entry_plugin.py",
  "tests/test_resources.py",
  "tests/unit/test_core.py",
];
const BATCH = 5;

async function forcedPass(ctx: TestContext, slots: boolean) {
  const found = findPython("3.13");
  if (!found.ok) {
    if (process.env.CI) throw new Error(`pytest fixture unavailable on CI: ${found.reason}`);
    return ctx.skip(`uv or Python 3.13 is absent: ${found.reason}`);
  }
  const repo = createRepo("basic");
  // No Vitest files: the Vitest lane's own backlog tier would share the pool.
  rmSync(join(repo.main, "test"), { recursive: true, force: true });
  const py = join(repo.main, "py");
  cpSync(SMALL, py, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.venv[^/]*|__pycache__|\.pytest_cache)$/.test(src),
  });
  mkdirSync(join(py, "tests/slots"), { recursive: true });
  writeFileSync(join(py, "tests/slots/__init__.py"), "");
  const sleeps = [...LIGHT.map((path) => [path, 0.05]), ...HEAVY.map((path) => [path, 1.5])];
  for (const [path, seconds] of sleeps) {
    writeFileSync(
      join(py, path as string),
      `import time\n\n\ndef test_sleeps():\n    time.sleep(${seconds})\n`,
    );
  }
  execFileSync("uv", ["sync", "--locked", "--python", found.python], {
    cwd: py,
    env: pythonEnv(),
    stdio: "pipe",
  });
  const scratch = mkdtempSync(join(tmpdir(), "squeal-pytest-slots-"));
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
  const store = openRepoStore(repo.commonDir);
  const [runner] = createPytestRunners(
    [{ name: "py", cwd: "py", args: [], env: {}, include: ["tests/**/test_*.py"] }],
    {
      root: repo.main as AbsolutePath,
      store,
      stateDir: join(scratch, "state") as AbsolutePath,
      tempDir: scratch as AbsolutePath,
      tierSize: () => 4,
      note: () => {},
    },
  );
  if (runner === undefined) throw new Error("no pytest runner");
  const { timed, runs } = timedRunner(runner, () => slots);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    // The default: one tier takes the whole backlog, as today.
    backlogTierSize: 200,
    adapters: [timed],
    capacity: { dir: join(scratch, "pool"), hostSlots: 4 },
    policy: RUN_MISSING,
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  const from = runs.length;
  const started = performance.now();
  await h.scheduler.requestFullSuite({ force: true });
  await h.scheduler.idle();
  const ms = performance.now() - started;
  const pass = runs.slice(from).map((run) => run.files.map((f) => f.path.replace(/^py\//, "")));
  const passed = h.store.knownStates
    .list(h.worktreeId)
    .filter((s) => s.outcome === "pass")
    .map((s) => s.check.testPath.replace(/^py\//, ""));
  await h.scheduler.close();
  return { ms, pass, passed };
}

describe("scheduler: a pytest backlog in slots of one batch (task 011-21 slice 2)", () => {
  it("5. packs light files into a batch per slot, a heavy file alone, measured against one tier", {
    timeout: 600_000,
  }, async (ctx) => {
    const load = loadavg()[0]?.toFixed(1);
    const tier = await forcedPass(ctx, false);
    const slots = await forcedPass(ctx, true);
    console.log(
      `011-21 pytest slots: ${slots.pass.length} runs of ${slots.pass.map((r) => r.length).join(", ")} files in ${Math.round(slots.ms)} ms; one tier: ${tier.pass.length} runs in ${Math.round(tier.ms)} ms (${(slots.ms / tier.ms).toFixed(2)} times), load ${load}`,
    );
    const all = [...FIXTURE, ...LIGHT, ...HEAVY].sort();
    expect(tier.pass).toHaveLength(1);
    expect(slots.pass.flat().sort()).toEqual(all);
    for (const heavy of HEAVY) expect(slots.pass).toContainEqual([heavy]);
    const light = slots.pass.filter((run) => !run.some((path) => HEAVY.includes(path)));
    // Packing stops at a heavy file in the queue's order: each may end a batch early.
    expect(light.every((run) => run.length <= BATCH)).toBe(true);
    expect(light.some((run) => run.length === BATCH)).toBe(true);
    expect(light.length).toBeLessThanOrEqual(
      Math.ceil((FIXTURE.length + LIGHT.length) / BATCH) + HEAVY.length,
    );
    for (const { passed } of [tier, slots]) expect(passed).toEqual(expect.arrayContaining(all));
  });
});
