import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool } from "../../src/core/capacity/index.js";
import type {
  NodeTestProject,
  RunOptions,
  Store,
  TestFileRef,
  WorktreeId,
} from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 001 D11 Capacity (task 001-376): backlog and checkpoint tiers take a
 * grant from the per-user pool, an edit's tier runs at `runner.tierSize`
 * without one, so another daemon's work never delays delivery.
 *
 * The pool here has 2 slots: one permit, held with another daemon's free
 * worker by a simulated daemon. A Vitest backlog tier is held on this
 * daemon's free worker; an edit to a node:test file, another lane, must run
 * beside it. Were the edit's tier to ask the pool it would find the free
 * worker taken and no permit free, and wait for the held tier.
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

function ntOutcome(store: Store, worktreeId: WorktreeId): string | undefined {
  return store.knownStates
    .list(worktreeId)
    .find((s) => s.check.testPath === NT_TEST && s.check.kind === "test")?.outcome;
}

describe("scheduler: the per-user pool (001 D11 Capacity, task 001-376)", SLOW, () => {
  it("runs an edit's tier without a grant while the pool and the daemon's free worker are taken", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "squeal-capacity-pool-")), "squeal-uid");
    onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    writeProject(repo.main);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      nodeTest: [NT],
      runnerPartBesideRun: true,
      capacity: { dir, hostSlots: 2 },
    });
    const runs: { files: readonly TestFileRef[]; options: RunOptions }[] = [];
    h.gate.before = (files, options) => {
      runs.push({ files, options });
    };
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(ntOutcome(store, h.worktreeId)).toBe("pass");
    // The baseline's tiers are the backlog's: each carried a grant, at most the host's 2.
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.options.workers).toBeGreaterThanOrEqual(1);
    expect(Math.max(...runs.map((r) => r.options.workers ?? 0))).toBeLessThanOrEqual(2);

    // Another daemon of the user takes the whole pool.
    const other = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 2,
    });
    onTestFinished(() => other.close());
    expect(other.acquire(200)?.grant).toBe(2);

    // A Vitest backlog tier, held on this daemon's free worker.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    let held = false;
    h.runner.beforeRun = async () => {
      held = true;
      await gate;
    };
    runs.length = 0;
    appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
    await h.batch("vitest.config.ts");
    await expect.poll(() => held).toBe(true);
    const backlog = runs.find((r) => r.files.some((f) => f.path.startsWith("test/")));
    expect(backlog?.options.workers).toBe(1);

    // The edit's tier starts beside it, without a grant.
    h.write("nt/src/a.mjs", "export const a = 2;\n");
    await h.batch("nt/src/a.mjs");
    await expect.poll(() => ntOutcome(store, h.worktreeId), { timeout: 30_000 }).toBe("fail");
    const edit = runs.find((r) => r.files.some((f) => f.path === NT_TEST));
    expect(edit).toBeDefined();
    expect(edit?.options.workers).toBeUndefined();
    expect(held).toBe(true);

    release();
    await h.scheduler.idle();
  });
});
