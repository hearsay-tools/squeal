import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore } from "./helpers.js";

/*
 * Task 001-366, done-when 7 (`research/backlog-wall-budget.md`), as task
 * 011-21 slice 2 left it: node:test runs its backlog in one-file slots, each
 * to its end, so an edit of a file a forced `run --all` still holds waits at
 * most one slot's file plus its own run (spec 011 C4 step 5 as amended for
 * slots), where a wall-budgeted tier made it wait `max(B, the tier's longest
 * file)`. Eight files sleep 1.2 to 2.4 s, `runner.tierSize` (4) slots of the
 * daemon's node:test runner. The Vitest half, an edit cancelling a backlog
 * tier within its graces, is `backlog-tiers.test.ts`.
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

describe("scheduler: a node:test edit waits at most one backlog slot (tasks 001-366, 011-21)", () => {
  it("is current within one slot's file plus its own run", {
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
      adapters: [nodeTest],
      policy: RUN_MISSING,
    });
    await h.scheduler.start();
    await h.scheduler.idle();

    const outcome = () =>
      store.knownStates
        .list(h.worktreeId)
        .find((s) => s.check.testPath === EDITED && s.check.kind === "test");
    expect(outcome()?.outcome).toBe("pass");
    const pass: (readonly TestFileRef[])[] = [];
    let editedAt = 0;
    let edit: Promise<void> | null = null;
    h.gate.before = (files) => {
      pass.push(files);
      if (edit !== null || !files.some((f) => f.path.startsWith("nt/test/h"))) return;
      // The agent edits once the node:test backlog has started.
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

    const longest = Math.max(...sleeps);
    // The edit's own run: one quick node:test process; 3 s of slack for process starts and load.
    const bound = longest + 3_000;
    console.log(
      `001-366, 011-21: node:test backlog in ${pass.length} runs of both lanes, longest file ${longest} ms; the edit was current after ${Math.round(waitedMs)} ms (bound ${bound} ms)`,
    );
    // The forced pass ran its node:test files in one-file slots, the edit's run included.
    const ntRuns = pass.filter((files) => files.some((f) => f.path.startsWith("nt/")));
    expect(ntRuns.flat().filter((f) => f.path.startsWith("nt/test/h"))).toHaveLength(8);
    expect(ntRuns.every((files) => files.length === 1)).toBe(true);
    expect(waitedMs).toBeLessThanOrEqual(bound);
  });
});
