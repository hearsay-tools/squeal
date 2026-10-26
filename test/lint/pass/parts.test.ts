import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolLease } from "../../../src/core/capacity/index.js";
import {
  CAPACITY_RECHECK_MS,
  TierCapacity,
  WAIT_FOR_CAPACITY,
} from "../../../src/core/scheduler/capacity.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/* Spec 017 D7 step 4: parts of at most 16, changed files first, one slot of the user's pool. */

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** The scheduler's pool over a fresh directory, `slots` wide, with no host gate. */
function pool(worktreeId: string, slots: number): TierCapacity {
  const dir = mkdtempSync(join(tmpdir(), "squeal-lint-pool-"));
  const capacity = new TierCapacity({ dir, hostSlots: slots, host: null }, worktreeId, () => {});
  cleanups.push(() => {
    capacity.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return capacity;
}

/** A grant, or why there is none. */
function grantOf(lease: PoolLease | typeof WAIT_FOR_CAPACITY | null): number | string {
  if (lease === null || lease === WAIT_FOR_CAPACITY) return String(lease);
  const grant = lease.grant;
  lease.release();
  return grant;
}

function files(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
}

describe("the lint pass's parts (spec 017 D7 step 4)", () => {
  it("lints at most 16 files a part, the latest revision's first", async () => {
    const tree = lintTree();
    for (const path of files(38)) tree.write(path, "ok\n");
    tree.revise();
    tree.write("src/z1.js", "ok\n").write("src/z2.js", "bad no-undef\n");
    tree.revise();
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider);
    pass.nudge();
    await pass.idle();
    expect(provider.calls.map((c) => c.length)).toEqual([16, 16, 8]);
    expect(provider.calls[0]).toEqual(["src/z1.js", "src/z2.js", ...files(14)]);
    expect(Object.keys(outcomes(storeOf(tree), tree))).toHaveLength(40);
    await pass.close();
  });

  it("ends a pass after its part when a revision comes, so the edit's file goes first", async () => {
    const tree = lintTree();
    for (const path of files(40)) tree.write(path, "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    let open = () => {};
    provider.gate = new Promise((resolve) => {
      open = resolve;
    });
    const { pass } = lintPass(tree, provider);
    pass.nudge();
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    tree.write("src/f39.js", "bad no-undef\n");
    tree.revise();
    pass.nudge();
    provider.gate = null;
    open();
    await pass.idle();
    expect(provider.calls[1]?.[0]).toBe("src/f39.js");
    expect(outcomes(storeOf(tree), tree)["src/f39.js"]).toBe("fail");
    await pass.close();
  });
});

describe("a lint part takes one slot of the user's pool (011 C10, agreed 2026-10-26)", () => {
  it("a backlog test tier's grant is one smaller while a first pass's part holds its lease", async () => {
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const capacity = pool(tree.id, 4);
    const provider = new FakeProvider();
    let open = () => {};
    provider.gate = new Promise((resolve) => {
      open = resolve;
    });
    const { pass } = lintPass(tree, provider, { capacity: () => capacity });
    expect(grantOf(capacity.take(4, "fast", 1, "backlog"))).toBe(4);
    pass.nudge();
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    expect(grantOf(capacity.take(4, "fast", 1, "backlog"))).toBe(3);
    open();
    await pass.idle();
    expect(grantOf(capacity.take(4, "fast", 1, "backlog"))).toBe(4);
    await pass.close();
  });

  it("a refused lease ends the pass and looks again at CAPACITY_RECHECK_MS, holding nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const capacity = pool(tree.id, 1);
    const tier = capacity.take(1, "fast", 1, "backlog");
    expect(tier).not.toBe(WAIT_FOR_CAPACITY);
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider, { capacity: () => capacity });
    pass.nudge();
    await pass.idle();
    expect(provider.calls).toEqual([]);
    expect(outcomes(storeOf(tree), tree)).toEqual({ "src/a.js": "pending" });

    (tier as PoolLease).release();
    await vi.advanceTimersByTimeAsync(CAPACITY_RECHECK_MS);
    await pass.idle();
    expect(provider.calls).toEqual([["src/a.js"]]);
    expect(grantOf(capacity.take(1, "fast", 1, "backlog"))).toBe(1);
    await pass.close();
  });

  it("an edit's own changed files run one worker wide, without a grant", async () => {
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const capacity = pool(tree.id, 2);
    const asked: string[] = [];
    const spy = {
      take: (...args: Parameters<TierCapacity["take"]>) => {
        asked.push(`take ${args.join(" ")}`);
        return capacity.take(...args);
      },
      running: (workers: number) => {
        asked.push(`running ${workers}`);
        const end = capacity.running(workers);
        return () => {
          asked.push("ended");
          end();
        };
      },
    };
    const provider = new FakeProvider();
    const { pass } = lintPass(tree, provider, { capacity: () => spy });
    pass.nudge();
    await pass.idle();
    tree.write("src/a.js", "bad no-undef\n");
    tree.revise();
    pass.nudge();
    await pass.idle();
    expect(asked).toEqual(["take 1 slow 1 backlog", "running 1", "ended"]);
    await pass.close();
  });
});
