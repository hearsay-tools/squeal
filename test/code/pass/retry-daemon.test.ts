import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readUncountable } from "../../../src/core/code/pass/index.js";
import { open } from "../helpers.js";
import { daemonPass, fakeCounter, flakyCounter, worktree } from "./helpers.js";

/*
 * Row 015-18 (review 0.1.283 S1) in the daemon: a timer nudges the pass
 * when a failed count's retry is due, with no edit to wake it. A starting
 * daemon gives each failed count a fresh budget, and a counter that did not
 * load is loaded again at the next pass.
 */

const A = "src/a.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Moves the clock by `ms`, then waits for the pass a timer started. */
async function elapse(code: { idle(): Promise<void> }, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await code.idle();
}

describe("the daemon retries a failed count (row 015-18)", () => {
  it("judges a file whose count threw once 5 s later, with no edit", async () => {
    const tree = worktree();
    tree.write(A, "settle 23 B1\n").revise();
    const counter = flakyCounter(1);
    const { code, reports } = daemonPass(tree, {
      counter: () => Promise.resolve(counter),
      now: Date.now,
    });
    code.nudge();
    await code.idle();
    await elapse(code, 4_999);
    expect(reports.map((r) => `${r.mode} ${r.counted}`)).toEqual(["first 0"]);
    await elapse(code, 1);
    await code.close();
    expect(reports.map((r) => `${r.mode} ${r.counted} ${r.transitions}`)).toEqual([
      "first 0 0",
      "edit 1 1",
    ]);
    expect(open(tree.commonDir).states.list(tree.id)).toMatchObject([
      { value: 23, outcome: "fail" },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tries a counter that always throws three times, then sets no timer", async () => {
    const tree = worktree();
    tree.write(A, "settle 23 B1\n").revise();
    const counter = flakyCounter(Infinity);
    const { code, errors } = daemonPass(tree, {
      counter: () => Promise.resolve(counter),
      now: Date.now,
    });
    code.nudge();
    await code.idle();
    await elapse(code, 5_000);
    await elapse(code, 60_000);
    expect(vi.getTimerCount()).toBe(0);
    await elapse(code, 24 * 3_600_000);
    code.nudge();
    await code.idle();
    await code.close();
    expect(counter.calls).toHaveLength(3);
    expect(errors).toEqual([]);
    expect(readUncountable(open(tree.commonDir).meta, tree.id).get(A)).toMatchObject({
      attempts: 3,
      retryAt: null,
    });
  });

  it("gives a starting daemon a fresh budget for a spent count", async () => {
    const tree = worktree();
    tree.write(A, "settle 23 B1\n").revise();
    const first = daemonPass(tree, {
      counter: () => Promise.resolve(flakyCounter(Infinity)),
      now: Date.now,
    });
    first.code.nudge();
    await first.code.idle();
    await elapse(first.code, 5_000);
    await elapse(first.code, 60_000);
    await first.code.close();
    const next = daemonPass(tree, { now: Date.now });
    next.code.nudge();
    await next.code.idle();
    await next.code.close();
    expect(next.reports.map((r) => `${r.mode} ${r.counted}`)).toEqual(["edit 1"]);
    expect(readUncountable(open(tree.commonDir).meta, tree.id)).toEqual(new Map());
  });

  it("clears its timer at close", async () => {
    const tree = worktree();
    tree.write(A, "settle 23 B1\n").revise();
    const { code } = daemonPass(tree, {
      counter: () => Promise.resolve(flakyCounter(1)),
      now: Date.now,
    });
    code.nudge();
    await code.idle();
    expect(vi.getTimerCount()).toBe(1);
    await code.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads a counter again at the next pass after a load that failed", async () => {
    const tree = worktree();
    tree.write(A, "settle 23 B1\n").revise();
    let loads = 0;
    const { code, errors, reports } = daemonPass(tree, {
      counter: () =>
        ++loads === 1
          ? Promise.reject(new Error("tree-sitter-tsx.wasm not found"))
          : Promise.resolve(fakeCounter()),
      now: Date.now,
    });
    code.nudge();
    await code.idle();
    code.nudge();
    await code.idle();
    await code.close();
    expect(loads).toBe(2);
    expect(errors.map((e) => e.message)).toEqual(["tree-sitter-tsx.wasm not found"]);
    expect(reports.map((r) => r.mode)).toEqual(["first"]);
  });
});
