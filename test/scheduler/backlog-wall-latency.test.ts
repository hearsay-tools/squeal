import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject, TestFileRef } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 001-366, done-when 7 (`research/backlog-wall-budget.md`): node:test
 * runs a backlog tier to its end, so an edit of one of its files waits for
 * the tier. Under the wall budget that wait stays within `max(B, the tier's
 * longest file)` plus the edit's own run. Scaled: `runner.timeoutMs` of 8 s
 * makes B 4 s, and eight files sleep 1.2 to 2.4 s, run `runner.tierSize` (4)
 * wide by the daemon's node:test runner. The Vitest half, an edit cancelling
 * a backlog tier within its graces, is `backlog-tiers.test.ts`.
 */
const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};
const EDITED = "nt/test/a.test.mjs";
const BUDGET_MS = 4_000;
const sleeps = Array.from({ length: 8 }, (_, i) => 1_200 + i * 170);

function writeProject(root: string): void {
  mkdirSync(join(root, "nt/src"), { recursive: true });
  mkdirSync(join(root, "nt/test"), { recursive: true });
  writeFileSync(join(root, "nt/src/a.mjs"), "export const a = 1;\n");
  const test = (body: string) =>
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      body,
      "",
    ].join("\n");
  writeFileSync(
    join(root, EDITED),
    test('import { a } from "../src/a.mjs";\ntest("a is one", () => assert.equal(a, 1));'),
  );
  for (const [i, ms] of sleeps.entries()) {
    writeFileSync(
      join(root, `nt/test/h${i}.test.mjs`),
      test(
        `test("sleeps", async () => { await new Promise((r) => setTimeout(r, ${ms})); assert.ok(true); });`,
      ),
    );
  }
}

describe("scheduler: a node:test edit waits at most one wall-budgeted backlog tier (task 001-366)", () => {
  it("is current within max(B, the tier's longest file) plus its own run", {
    timeout: 120_000,
  }, async () => {
    const repo = createRepo("basic");
    writeProject(repo.main);
    const store = openRepoStore(repo.commonDir);
    const [nodeTest] = createNodeTestRunners([NT], {
      root: repo.main,
      store,
      tempDir: join(repo.main, ".."),
      tierSize: () => 4,
      note: () => {},
    });
    if (nodeTest === undefined) throw new Error("no node:test runner");
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 200,
      timeoutMs: 2 * BUDGET_MS,
      adapters: [nodeTest],
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    const outcome = () =>
      store.knownStates
        .list(h.worktreeId)
        .find((s) => s.check.testPath === EDITED && s.check.kind === "test");
    expect(outcome()?.outcome).toBe("pass");
    let tier: readonly TestFileRef[] | null = null;
    let editedAt = 0;
    let edit: Promise<void> | null = null;
    h.gate.before = (files) => {
      if (tier !== null || !files.some((f) => f.path.startsWith("nt/test/h"))) return;
      tier = files;
      // The agent edits once the node:test backlog tier has started.
      edit = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        h.write("nt/src/a.mjs", "export const a = 2;\n");
        editedAt = performance.now();
        await h.batch("nt/src/a.mjs");
      })();
    };
    await h.scheduler.requestFullSuite({ force: true });
    await expect.poll(() => edit !== null, { timeout: 30_000 }).toBe(true);
    await edit;
    await expect.poll(() => outcome()?.outcome, { timeout: 60_000, interval: 50 }).toBe("fail");
    const waitedMs = performance.now() - editedAt;
    await h.scheduler.idle();

    const ran = (tier ?? []) as readonly TestFileRef[];
    const longest = Math.max(
      0,
      ...ran.map((f) => sleeps[Number(f.path.match(/h(\d+)/)?.[1] ?? -1)] ?? 0),
    );
    // The edit's own run: one quick node:test process; 3 s of slack for process starts and load.
    const bound = Math.max(BUDGET_MS, longest) + 3_000;
    console.log(
      `001-366: node:test backlog tier of ${ran.length} files, longest ${longest} ms; the edit was current after ${Math.round(waitedMs)} ms (bound ${bound} ms)`,
    );
    // The rule held the tier to one round of 4 and three more, not all 9 files.
    expect(ran.length).toBeGreaterThanOrEqual(4);
    expect(ran.length).toBeLessThan(9);
    expect(waitedMs).toBeLessThanOrEqual(bound);
  });
});
