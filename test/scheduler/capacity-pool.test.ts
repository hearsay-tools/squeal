import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { createPermitPool, readMarks } from "../../src/core/capacity/index.js";
import { CAPACITY_RECHECK_MS } from "../../src/core/scheduler/capacity.js";
import type {
  NodeTestProject,
  RunOptions,
  Store,
  TestFileRef,
  WorktreeId,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 001 D11 Capacity (task 001-376): backlog and checkpoint tiers take a
 * grant from the per-user pool, an edit's tier runs at `runner.tierSize`
 * without one, so another daemon's work never delays delivery.
 *
 * The pool here has 2 slots, each a permit (011 C10 as amended 2026-10-21,
 * row 011-96): one held by a simulated daemon, the other by this daemon's
 * Vitest backlog tier; an edit to a node:test file, another lane, must run
 * beside it. Were the edit's tier to ask the pool it would find no permit
 * free, and wait for the held tier.
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
  it("runs an edit's tier without a grant while the pool is taken", async () => {
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
      policy: RUN_MISSING,
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

    // Another daemon of the user takes one permit.
    const other = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 2,
    });
    onTestFinished(() => other.close());
    expect(other.acquire(1)?.grant).toBe(1);

    // A Vitest backlog tier, held on the other permit.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    h.runner.beforeRun = async () => {
      held = true;
      await gate;
    };
    // Released before the harness's close, which waits for the held tier (row 011-218).
    try {
      runs.length = 0;
      appendFileSync(join(h.root, "vitest.config.ts"), "// environment change\n");
      await h.batch("vitest.config.ts");
      // It waits for the batch's re-key and a permit: on a loaded host, past the 1 s default.
      await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
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
    } finally {
      release();
    }
    await h.scheduler.idle();
  });

  it("a backlog tier that finds no permit holds no claim, looks again every few seconds, and starts after a release", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "squeal-capacity-wait-")), "squeal-uid");
    onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
    // Another daemon of the user holds the whole pool before this one starts.
    const other = createPermitPool({
      dir,
      owner: { pid: process.pid, worktreeId: "other-daemon" },
      hostSlots: 2,
    });
    onTestFinished(() => other.close());
    const held = other.acquire(200);
    expect(held?.permits).toBe(2);
    const repo = createRepo("basic");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      backlogTierSize: 50,
      capacity: { dir, hostSlots: 2 },
      policy: RUN_MISSING,
    });
    const runs: { at: number; options: RunOptions }[] = [];
    h.gate.before = (_files, options) => {
      runs.push({ at: performance.now(), options });
    };
    await h.scheduler.start();

    // The baseline is the backlog's: it waits, marked, with no run and no key claimed.
    const own = () => readMarks(dir, "reader", Date.now()).find((m) => m.id === h.worktreeId);
    await expect.poll(() => own()?.since ?? null, { timeout: 30_000 }).not.toBeNull();
    expect(own()?.grant).toBe(0);
    // Each look rewrites the mark: a pump that looked in a loop would rewrite it constantly.
    const mark = markFile(dir, h.worktreeId);
    const looks = new Set<number>();
    const until = performance.now() + CAPACITY_RECHECK_MS + 500;
    while (performance.now() < until) {
      looks.add(statSync(mark).mtimeMs);
      await delay(25);
    }
    expect(looks.size).toBeLessThanOrEqual(3);
    expect(runs).toEqual([]);
    const running = store.testFileKeys.list(h.worktreeId).filter((r) => r.pending === "running");
    expect(running).toEqual([]);

    // The holder's tier ends: no event of this daemon's, so its next look starts the baseline.
    const releasedAt = performance.now();
    held?.release();
    await expect.poll(() => runs.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(runs[0]?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(
      releasedAt + CAPACITY_RECHECK_MS + 4_000,
    );
    expect(runs[0]?.options.workers).toBe(2);
    await h.scheduler.idle();
  });
});

/** The file of `worktreeId`'s mark in the pool's directory, named as `marks.ts` names it. */
function markFile(dir: string, worktreeId: string): string {
  const name = createHash("sha256").update(worktreeId).digest("hex").slice(0, 16);
  return join(dir, `pool.mark.${name}`);
}
