import { describe, expect, it } from "vitest";
import { readUncountable } from "../../../src/core/code/pass/index.js";
import { countingOf } from "../../../src/core/delivery/code-deliver.js";
import { blobHash } from "../../../src/core/hash/index.js";
import { open } from "../helpers.js";
import { fakeCounter, flakyCounter, pass, policyOn, worktree } from "./helpers.js";

/*
 * Row 015-18 (review 0.1.283 S1): a count the counter fails on is tried
 * again when its retry is due, 5 s and then 60 s after a failure, three
 * times in all; then not until the file's blob changes. The file keeps its
 * last judged states meanwhile, and the code meta records the failure.
 */

const A = "src/a.ts";
const blob = (text: string) => blobHash(Buffer.from(text), "sha1");

/** A worktree whose `src/a.ts` was counted at `settle 3 B1`, then edited to `settle 23 B2`. */
async function edited() {
  const tree = worktree();
  const store = open(tree.commonDir);
  tree.write(A, "settle 3 B1\n").revise();
  await pass(tree, store, fakeCounter(), { now: () => 1_000 });
  tree.write(A, "settle 23 B2\n").revise();
  return { tree, store };
}

describe("a failed count is retried (row 015-18)", () => {
  it("judges a file whose count threw once at the pass its retry is due", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(1);
    const failed = await pass(tree, store, counter, { now: () => 2_000 });
    expect(failed).toMatchObject({ counted: 0, transitions: 0 });
    expect(store.states.list(tree.id)).toMatchObject([
      { value: 3, outcome: "pass", blob: blob("settle 3 B1\n") },
    ]);
    expect(readUncountable(store.meta, tree.id).get(A)).toEqual({
      blob: blob("settle 23 B2\n"),
      attempts: 1,
      retryAt: 7_000,
      error: "tree-sitter: out of memory",
      threshold: 20,
      editedAt: 2,
    });
    // Before the retry is due nothing is, and another file's edit counts only that file.
    expect(await pass(tree, store, counter, { now: () => 6_999 })).toBeNull();
    tree.write("src/b.ts", "pay 2 B3\n").revise();
    expect(await pass(tree, store, counter, { now: () => 6_999 })).toMatchObject({ files: 1 });
    expect(counter.calls).toHaveLength(2);
    const retried = await pass(tree, store, counter, { now: () => 7_000 });
    expect(retried).toMatchObject({ revision: 3, files: 1, counted: 1, transitions: 1 });
    expect(store.states.list(tree.id, { paths: [A] })).toMatchObject([
      { value: 23, outcome: "fail", countedAt: 3, blob: blob("settle 23 B2\n") },
    ]);
    expect(readUncountable(store.meta, tree.id)).toEqual(new Map());
    expect(store.meta.get(`uncountable:${tree.id}`)).toBeNull();
  });

  it("stops after three attempts, 5 s and 60 s apart, and keeps the judged state", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    const logs: string[] = [];
    const at = (now: number) =>
      pass(tree, store, counter, { now: () => now, log: (t) => logs.push(t) });
    expect(await at(2_000)).toMatchObject({ counted: 0 });
    // The readers' counting: pending while a retry is to come, then out of it (row 015-18).
    expect(countingOf(store, tree.id)).toEqual({ done: 0, total: 1, uncountable: 0 });
    expect(await at(6_999)).toBeNull();
    expect(await at(7_000)).toMatchObject({ counted: 0 });
    expect(await at(66_999)).toBeNull();
    expect(await at(67_000)).toMatchObject({ counted: 0 });
    expect(await at(10_000_000)).toBeNull();
    expect(counter.calls).toHaveLength(3);
    expect(readUncountable(store.meta, tree.id).get(A)).toMatchObject({
      attempts: 3,
      retryAt: null,
    });
    expect(countingOf(store, tree.id)).toEqual({ done: 0, total: 0, uncountable: 1 });
    expect(store.states.list(tree.id)).toMatchObject([{ value: 3, outcome: "pass" }]);
    expect(logs).toEqual([
      "complexity: could not count src/a.ts (attempt 1 of 3): tree-sitter: out of memory; trying again in 5 s",
      "complexity: could not count src/a.ts (attempt 2 of 3): tree-sitter: out of memory; trying again in 60 s",
      "complexity: could not count src/a.ts (attempt 3 of 3): tree-sitter: out of memory; not again until it changes",
    ]);
  });

  it("never counts a spent blob again: not for the same bytes written again, nor a recount", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    for (const now of [2_000, 7_000, 67_000]) await pass(tree, store, counter, { now: () => now });
    tree.write(A, "settle 23 B2\n").revise();
    expect(await pass(tree, store, counter, { now: () => 100_000 })).toMatchObject({ counted: 0 });
    const recount = await pass(tree, store, counter, {
      now: () => 200_000,
      policy: policyOn({ threshold: 10 }),
    });
    expect(recount).toMatchObject({ mode: "threshold", counted: 0 });
    expect(counter.calls).toHaveLength(3);
    expect(readUncountable(store.meta, tree.id).get(A)).toMatchObject({
      attempts: 3,
      retryAt: null,
    });
  });

  it("gives a copy of a spent blob at another path its own attempts, and the first none more", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    for (const now of [2_000, 7_000, 67_000]) await pass(tree, store, counter, { now: () => now });
    // One revision with both: one blob, so one count for the two paths.
    tree.write(A, "settle 23 B2\n").write("src/copy.ts", "settle 23 B2\n").revise();
    await pass(tree, store, counter, { now: () => 100_000 });
    expect(counter.calls).toHaveLength(4);
    const failed = readUncountable(store.meta, tree.id);
    expect(failed.get(A)).toMatchObject({ attempts: 3, retryAt: null });
    expect(failed.get("src/copy.ts")).toMatchObject({ attempts: 1, retryAt: 105_000 });
  });

  it("counts the next blob of a spent file with a fresh budget", async () => {
    const { tree, store } = await edited();
    const broken = flakyCounter(Infinity);
    for (const now of [2_000, 7_000, 67_000]) await pass(tree, store, broken, { now: () => now });
    tree.write(A, "settle 24 B4\n").revise();
    expect(await pass(tree, store, flakyCounter(1), { now: () => 100_000 })).toMatchObject({
      counted: 0,
    });
    expect(readUncountable(store.meta, tree.id).get(A)).toMatchObject({
      blob: blob("settle 24 B4\n"),
      attempts: 1,
      retryAt: 105_000,
    });
    tree.write(A, "settle 25 B5\n").revise();
    expect(await pass(tree, store, fakeCounter(), { now: () => 101_000 })).toMatchObject({
      counted: 1,
    });
    expect(readUncountable(store.meta, tree.id)).toEqual(new Map());
  });

  it("judges a spent file at the next pass once another worktree counted its blob", async () => {
    const { tree, store } = await edited();
    for (const now of [2_000, 7_000, 67_000]) {
      await pass(tree, store, flakyCounter(Infinity), { now: () => now });
    }
    const other = worktree("w2", tree.commonDir);
    other.write(A, "settle 23 B2\n").revise();
    await pass(other, store, fakeCounter(), { now: () => 70_000 });
    // The count is stored: the readers no longer call the file uncountable.
    expect(countingOf(store, tree.id)).toEqual({ done: 1, total: 1, uncountable: 0 });
    const counter = fakeCounter();
    expect(await pass(tree, store, counter, { now: () => 71_000 })).toMatchObject({
      counted: 0,
      transitions: 1,
    });
    expect(counter.calls).toEqual([]);
    expect(store.states.list(tree.id)).toMatchObject([{ value: 23, outcome: "fail" }]);
    expect(readUncountable(store.meta, tree.id)).toEqual(new Map());
  });

  it("forgets a failed count when its file is removed", async () => {
    const { tree, store } = await edited();
    await pass(tree, store, flakyCounter(Infinity), { now: () => 2_000 });
    tree.remove(A).revise();
    await pass(tree, store, fakeCounter(), { now: () => 3_000 });
    expect(readUncountable(store.meta, tree.id)).toEqual(new Map());
    expect(store.states.list(tree.id)).toEqual([]);
  });
});
