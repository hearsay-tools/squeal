import { describe, expect, it } from "vitest";
import { readUncountable } from "../../../src/core/code/pass/index.js";
import type { CodeCheckId } from "../../../src/core/types/code.js";
import { open } from "../helpers.js";
import { fakeCounter, flakyCounter, pass, policyOn, worktree } from "./helpers.js";
import { told } from "./told.js";

/*
 * Row 015-31 (review 0.1.293-r2 N1): an edit whose count threw, held by a
 * threshold recount until its retry, is judged as the edit under the
 * threshold it was made under, then the new threshold's as the recount's.
 * It tells only its own crossing; one that only the new threshold makes is
 * the recount's summary (D1), never a transition or a session regression.
 */

const OLD = "src/old.ts";

/**
 * Revision 1 counts `before` at threshold 20. Revision 2 writes `after`,
 * whose count throws at 2,000; a recount to `threshold` at 3,000 holds it,
 * and its retry at 7,000 counts it.
 */
async function heldEdit(before: string, after: string, threshold: number) {
  const tree = worktree();
  const store = open(tree.commonDir);
  tree.write(OLD, before).revise();
  await pass(tree, store, fakeCounter(), { now: () => 1_000 });
  tree.write(OLD, after).revise();
  const counter = flakyCounter(1);
  await pass(tree, store, counter, { now: () => 2_000 });
  const policy = policyOn({ threshold });
  expect(await pass(tree, store, counter, { now: () => 3_000, policy })).toMatchObject({
    mode: "threshold",
    counted: 0,
  });
  expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({ threshold: 20 });
  const retry = await pass(tree, store, counter, { now: () => 7_000, policy });
  const history = (qualifiedName: string) => {
    const check: CodeCheckId = { kind: "code", path: OLD, qualifiedName, occurrence: 0 };
    return store.transitions.history(tree.id, check).map((t) => `${t.kind} ${t.revision}`);
  };
  return { tree, store, retry, history };
}

describe("a held edit tells only its own crossing (row 015-31)", () => {
  it("tells nothing of CC 3 -> 4 that only the threshold moved from 20 to 2 put over", async () => {
    const { tree, store, retry } = await heldEdit("old 3 B1\n", "old 4 B2\n", 2);
    expect(retry).toMatchObject({ revision: 2, mode: "edit", counted: 1, transitions: 0 });
    expect(store.states.list(tree.id, { paths: [OLD] })).toMatchObject([
      { value: 4, outcome: "fail", threshold: 2, changedAt: 2 },
    ]);
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("still tells a genuine CC 3 -> 23 edit under the same sequence as FAIL", async () => {
    const { tree, store, retry } = await heldEdit("old 3 B1\n", "old 23 B2\n", 2);
    expect(retry).toMatchObject({ revision: 2, mode: "edit", counted: 1, transitions: 1 });
    expect(told(store, tree)).toEqual({
      entries: ["pass-to-fail old 2"],
      wentOver: ["old"],
      writes: ["old fail full"],
    });
  });

  it("tells no first-seen fail of a function the held edit added under the old threshold", async () => {
    const { tree, store, retry } = await heldEdit("old 1 B1\n", "old 1 B1\nfresh 4 F\n", 2);
    expect(retry).toMatchObject({ counted: 1, transitions: 0 });
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["fresh fail count"] });
  });

  it("keeps the first failed edit's threshold through the next edit that fails", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 3 B1\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => 1_000 });
    const counter = flakyCounter(2);
    tree.write(OLD, "old 4 B2\n").revise();
    await pass(tree, store, counter, { now: () => 2_000 });
    const policy = policyOn({ threshold: 2 });
    await pass(tree, store, counter, { now: () => 3_000, policy });
    tree.write(OLD, "old 5 B3\n").revise();
    await pass(tree, store, counter, { now: () => 4_000, policy });
    expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({
      attempts: 1,
      threshold: 20,
    });
    expect(await pass(tree, store, counter, { now: () => 9_000, policy })).toMatchObject({
      counted: 1,
      transitions: 0,
    });
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("judges by the states' threshold an edit that failed after a recount's count failed", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 3 B1\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => 1_000 });
    const counter = flakyCounter(2);
    const policy = policyOn({ threshold: 2 });
    tree.write(OLD, "old 4 B2\n").revise();
    await pass(tree, store, counter, { now: () => 2_000, policy });
    expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({ quiet: true });
    tree.write(OLD, "old 5 B3\n").revise();
    await pass(tree, store, counter, { now: () => 3_000, policy });
    expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({ threshold: 2 });
    expect(await pass(tree, store, counter, { now: () => 8_000, policy })).toMatchObject({
      counted: 1,
      transitions: 0,
    });
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("tells no PASS that only a raised threshold makes, and still a genuine one", async () => {
    const { retry, history } = await heldEdit("a 23 A1\nb 23 B1\n", "a 24 A2\nb 3 B2\n", 30);
    expect(retry).toMatchObject({ counted: 1, transitions: 1 });
    expect(history("a")).toEqual([]);
    expect(history("b")).toEqual(["fail-to-pass 2"]);
  });
});
