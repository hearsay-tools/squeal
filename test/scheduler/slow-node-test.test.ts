import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { DEFAULT_POLICY, type NodeTestProject } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 4, B2 (task 004-37): an idle slow tier of node:test files
 * starts every file it holds, whatever `runner.tierSize` is, so no file of a
 * noncancellable slow tier starts after an edit arrived or the scheduler
 * closed (spec 004 D2, D4). The real node:test adapter runs at
 * `runner.tierSize` concurrency, as the daemon's does. Each slow file
 * appends to its `started-<name>` marker, then waits for its `release-<name>`.
 */

// After every harness closed: a held file's release must find its directory.
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function project(name: string): NodeTestProject {
  return {
    name,
    cwd: name,
    node: process.execPath,
    argv: [],
    env: {},
    include: ["test/*.test.mjs"],
  };
}

function heldTest(markers: string, name: string): string {
  const at = (file: string) => JSON.stringify(join(markers, `${file}-${name}`));
  return [
    'import { appendFileSync, existsSync } from "node:fs";',
    'import { test } from "node:test";',
    'test("holds until released", async () => {',
    `  appendFileSync(${at("started")}, "x");`,
    "  const deadline = Date.now() + 90_000;",
    `  while (!existsSync(${at("release")}) && Date.now() < deadline) {`,
    "    await new Promise((done) => setTimeout(done, 25));",
    "  }",
    "});",
    "",
  ].join("\n");
}

const FAST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'test("fast", () => assert.equal(1, 1));',
  "",
].join("\n");

/** Before the harness opens: the node:test adapters list their files when created. */
function writeProject(root: string, name: string, slow: readonly string[], markers: string): void {
  mkdirSync(join(root, name, "test"), { recursive: true });
  writeFileSync(join(root, name, "test/fast.test.mjs"), FAST);
  for (const file of slow) {
    writeFileSync(join(root, name, `test/slow-${file}.test.mjs`), heldTest(markers, file));
  }
}

/** How many times each slow file started. */
function starts(markers: string, names: readonly string[]): Record<string, number> {
  const read = (name: string) => {
    const path = join(markers, `started-${name}`);
    return existsSync(path) ? readFileSync(path, "utf8").length : 0;
  };
  return Object.fromEntries(names.map((name) => [name, read(name)]));
}

const release = (markers: string, name: string) =>
  writeFileSync(join(markers, `release-${name}`), "");

async function open(projects: Record<string, readonly string[]>, maxParallel: number) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  const markers = scratch("squeal-004-37-markers-");
  const names = Object.values(projects).flat();
  onTestFinished(() => {
    for (const name of names) release(markers, name);
  });
  for (const [name, slow] of Object.entries(projects)) writeProject(repo.main, name, slow, markers);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 1,
    nodeTest: Object.keys(projects).map(project),
    nodeTestTierSize: true,
    runnerPartBesideRun: true,
    policy: {
      nodeTest: Object.keys(projects).map(project),
      slow: { ...DEFAULT_POLICY.slow, include: ["*/test/slow-*.test.mjs"], maxParallel },
    },
    slow: {
      slotDir: scratch("squeal-004-37-slot-"),
      recheckMs: 50,
      load: () => [0],
      cpus: () => 1,
    },
  });
  // In a turn until the baseline's fast work is done, then idle: an idle tier.
  const { delivery, consumer } = await h.consumer();
  await delivery.startTurn(consumer);
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(starts(markers, names)).toEqual(Object.fromEntries(names.map((n) => [n, 0])));
  await delivery.endTurn(consumer);
  return { h, markers, names };
}

/** A Vitest tier of `path` held until `release`; `held` is true once a run of it waits. */
function holdVitest(h: Harness, path: string) {
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const state = { held: false, release: () => open() };
  onTestFinished(() => open());
  h.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === path)) return;
    state.held = true;
    await gate;
  };
  return state;
}

/** An edit of the Vitest fixture whose tier is held; resolves once it is. */
async function heldEdit(h: Harness) {
  const vitest = holdVitest(h, "test/math.test.ts");
  h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 0;\n");
  await h.batch("src/math.ts");
  await expect.poll(() => vitest.held, { timeout: 30_000 }).toBe(true);
  return vitest;
}

describe("an idle node:test slow tier starts all its files (review wave 4, B2)", SLOW, () => {
  it("starts slow.maxParallel files at once with runner.tierSize 1, and none again after an edit", async () => {
    const { h, markers, names } = await open({ nt: ["a", "b", "c"] }, 3);
    await expect
      .poll(() => starts(markers, names), { timeout: 60_000 })
      .toEqual({ a: 1, b: 1, c: 1 });

    // An edit's fast tier, held, while the three are in flight; they finish (D4).
    const vitest = await heldEdit(h);
    for (const name of names) release(markers, name);
    await delay(1_500);
    expect(vitest.held).toBe(true);
    expect(starts(markers, names)).toEqual({ a: 1, b: 1, c: 1 });
    vitest.release();
    await h.scheduler.idle();
    expect(starts(markers, names)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("starts no file of the tier after the scheduler closed", async () => {
    const { h, markers, names } = await open({ nt: ["a", "b", "c"] }, 3);
    await expect
      .poll(() => starts(markers, names), { timeout: 60_000 })
      .toEqual({ a: 1, b: 1, c: 1 });
    const closed = h.scheduler.close();
    for (const name of names) release(markers, name);
    await closed;
    expect(starts(markers, names)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it("keeps a tier within one node:test project, so the next project waits for an edit's fast tier", async () => {
    const { h, markers, names } = await open({ n1: ["a", "b"], n2: ["c", "d"] }, 4);
    await expect
      .poll(() => Object.values(starts(markers, names)).reduce((a, b) => a + b), {
        timeout: 60_000,
      })
      .toBe(2);
    const first = Object.entries(starts(markers, names))
      .filter(([, n]) => n === 1)
      .map(([name]) => name)
      .sort();
    // Both started files are one project's: n1's a and b, or n2's c and d.
    expect([
      ["a", "b"],
      ["c", "d"],
    ]).toContainEqual(first);
    const rest = names.filter((name) => !first.includes(name));

    const vitest = await heldEdit(h);
    for (const name of first) release(markers, name);
    await delay(2_000);
    // The edit's fast tier is held: the other project's files wait (D2).
    expect(vitest.held).toBe(true);
    for (const name of rest) expect(starts(markers, [name])[name]).toBe(0);

    vitest.release();
    await expect
      .poll(() => rest.map((name) => starts(markers, [name])[name]), { timeout: 60_000 })
      .toEqual([1, 1]);
    for (const name of rest) release(markers, name);
    await h.scheduler.idle();
  });
});
