import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { NodeTestProject, Store, WorktreeId } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons 003, defect 2: at r4 the edit touched only node:test files, whose
 * run started 4 min 17 s later, behind a 425 s Vitest tier of r2; until then
 * even the runner part stayed pending. Spec 001 D5 as amended (task
 * 001-140): a tier holds the files of one lane, `RunnerAdapter.lane`, and
 * tiers of different lanes run at once, one per lane.
 *
 * Fixture `basic` with a node:test project `nt` beside it: `nt/test/a.test.mjs`
 * imports `nt/src/a.mjs`; Vitest's include does not reach `nt/`.
 */

const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const NT_TEST = "nt/test/a.test.mjs";

/** Before the harness opens: the node:test adapter lists its files when it is created. */
function writeProject(root: string): void {
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, "nt/src/a.mjs"), "export const a = 1;\n");
  writeFileSync(
    join(root, NT_TEST),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { a } from "../src/a.mjs";',
      'test("a is one", () => assert.equal(a, 1));',
      "",
    ].join("\n"),
  );
}

/** The node:test file's known outcome for its test, as `squeal status` reads it. */
function ntOutcome(store: Store, worktreeId: WorktreeId): string | undefined {
  return store.knownStates
    .list(worktreeId)
    .find((s) => s.check.testPath === NT_TEST && s.check.kind === "test")?.outcome;
}

/** A Vitest tier held until `release`; `held` is true once a run of `path` waits. */
function holdVitest(h: Harness, path: string) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { held: false, release: () => release() };
  // A failed assertion still lets the scheduler close.
  onTestFinished(() => release());
  h.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === path)) return;
    state.held = true;
    await gate;
  };
  return state;
}

const HELD = "test/held.test.ts";

const markerDirs: string[] = [];
// Before the harness's cleanup closes the adapter (hooks run as a stack):
// removing the hold releases the worker, so a failed test still closes.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A Vitest test file whose worker waits while `hold` exists, after writing
 * `started`; `version` changes its bytes, so a revision reaches it.
 */
function heldTest(hold: string, started: string, version: number): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { it } from "vitest";',
    `it("waits while held (version ${version})", async () => {`,
    `  if (!existsSync(${JSON.stringify(hold)})) return;`,
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "}, 120_000);",
    "",
  ].join("\n");
}

async function openMixed(runnerPartBesideRun: boolean, files: Record<string, string> = {}) {
  const repo = createRepo("basic");
  const store = openRepoStore(repo.commonDir);
  writeProject(repo.main);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(repo.main, path), content);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    nodeTest: [NT],
    runnerPartBesideRun,
  });
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(ntOutcome(store, h.worktreeId)).toBe("pass");
  return { h, store };
}

describe("scheduler: lanes (001 D5 as amended, task 001-140)", SLOW, () => {
  it("runs and stores a newer revision's node:test file while an older revision's Vitest tier is in flight", async () => {
    const { h, store } = await openMixed(true);
    const vitest = holdVitest(h, "test/math.test.ts");
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    await h.batch("src/math.ts");
    await expect.poll(() => vitest.held).toBe(true);
    const older = store.revisions.latest(h.worktreeId)?.number ?? 0;

    h.write("nt/src/a.mjs", "export const a = 2;\n");
    await h.batch("nt/src/a.mjs");
    const newer = older + 1;
    expect(store.revisions.latest(h.worktreeId)?.number).toBe(newer);

    // The Vitest tier of the older revision is still held: the newer revision's
    // runner part landed, and its node:test file ran and was stored.
    await expect.poll(() => ntOutcome(store, h.worktreeId), { timeout: 30_000 }).toBe("fail");
    expect(vitest.held).toBe(true);
    expect(h.runsOf("test/math.test.ts")).toHaveLength(1);
    expect(h.header()).toMatchObject({ refinedRevision: newer, runnerPartPending: false });

    vitest.release();
    await h.scheduler.idle();
    expect(h.runsOf("test/math.test.ts")).toHaveLength(2);
    expect(h.header()).toMatchObject({
      revision: newer,
      counts: { pending: 0, stale: 0, unknown: 0 },
    });
  });

  it("lands a newer revision's runner part and node:test result while a real Vitest worker is mid-run (task 001-150)", async () => {
    const markers = mkdtempSync(join(tmpdir(), "squeal-001-150-"));
    const hold = join(markers, "hold");
    const started = join(markers, "started");
    markerDirs.push(markers);
    const { h, store } = await openMixed(true, { [HELD]: heldTest(hold, started, 1) });
    expect(h.runsOf(HELD)).toHaveLength(1);

    // The older revision's Vitest tier: its worker is inside the test, in the adapter's run.
    writeFileSync(hold, "");
    h.write(HELD, heldTest(hold, started, 2));
    await h.batch(HELD);
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    const older = store.revisions.latest(h.worktreeId)?.number ?? 0;

    h.write("nt/src/a.mjs", "export const a = 2;\n");
    await h.batch("nt/src/a.mjs");
    const newer = older + 1;

    // Through the composite, the Vitest adapter's `invalidate` and `affected`
    // answered beside its run; the node:test tier ran and stored its result.
    await expect.poll(() => ntOutcome(store, h.worktreeId), { timeout: 30_000 }).toBe("fail");
    expect(h.header()).toMatchObject({ refinedRevision: newer, runnerPartPending: false });
    expect(existsSync(hold)).toBe(true);
    expect(h.runsOf(HELD)).toHaveLength(1);

    rmSync(hold);
    await h.scheduler.idle();
    expect(h.runsOf(HELD)).toHaveLength(2);
    expect(h.header()).toMatchObject({
      revision: newer,
      counts: { pending: 0, stale: 0, unknown: 0 },
    });
  });

  it("runs a node:test tier beside a Vitest tier in flight once its runner part landed", async () => {
    const { h, store } = await openMixed(false);
    const vitest = holdVitest(h, "test/math.test.ts");
    // One revision reaches both lanes; Vitest's project "" orders first and is held.
    h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
    h.write("nt/src/a.mjs", "export const a = 2;\n");
    await h.batch("src/math.ts", "nt/src/a.mjs");

    await expect.poll(() => ntOutcome(store, h.worktreeId), { timeout: 30_000 }).toBe("fail");
    expect(vitest.held).toBe(true);
    expect(h.runsOf("test/math.test.ts")).toHaveLength(1);

    vitest.release();
    await h.scheduler.idle();
    expect(h.runsOf("test/math.test.ts")).toHaveLength(2);
    expect(h.header().counts).toMatchObject({ pending: 0, stale: 0, unknown: 0 });
  });
});
