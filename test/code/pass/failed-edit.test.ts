import { describe, expect, it } from "vitest";
import { restartRetries } from "../../../src/core/code/pass/failed.js";
import { readUncountable } from "../../../src/core/code/pass/index.js";
import { open } from "../helpers.js";
import { fakeCounter, flakyCounter, pass, policyOn, worktree } from "./helpers.js";

/*
 * Row 015-49: a failed count keeps the revision of the edit that brought
 * its blob, as `tooBigEdits` keeps a too-big file's (015-39), so D6 names a
 * file that could not be counted to the session whose edit it was. A
 * retry, a restart's retries and a recount keep it; a first count has none.
 */

const A = "src/a.ts";
const B = "src/b.ts";

/** `src/a.ts` counted at revision 1, edited at revision 2, and `src/b.ts` written at revision 3. */
async function edited() {
  const tree = worktree();
  const store = open(tree.commonDir);
  tree.write(A, "settle 3 B1\n").revise();
  await pass(tree, store, fakeCounter(), { now: () => 1_000 });
  tree.write(A, "settle 23 B2\n").revise();
  tree.write(B, "pay 2 B3\n").revise();
  return { tree, store };
}

describe("a failed count keeps its edit's revision (row 015-49)", () => {
  it("records the edit's own revision, not the pass's, and keeps it through the retries", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    expect(await pass(tree, store, counter, { now: () => 2_000 })).toMatchObject({ revision: 3 });
    const failed = () => readUncountable(store.meta, tree.id);
    expect(failed().get(A)).toMatchObject({ attempts: 1, editedAt: 2 });
    expect(failed().get(B)).toMatchObject({ attempts: 1, editedAt: 3 });
    tree.write("src/c.ts", "pay 1 B4\n").revise();
    await pass(tree, store, counter, { now: () => 7_000 });
    await pass(tree, store, counter, { now: () => 67_000 });
    expect(failed().get(A)).toMatchObject({ attempts: 3, retryAt: null, editedAt: 2 });
    // A daemon's start gives a fresh budget, and the retry it makes keeps the edit.
    restartRetries(store.meta, tree.id, 100_000);
    expect(failed().get(A)).toMatchObject({ attempts: 0, editedAt: 2 });
    await pass(tree, store, counter, { now: () => 100_000 });
    expect(failed().get(A)).toMatchObject({ attempts: 1, retryAt: 105_000, editedAt: 2 });
  });

  it("keeps it through a recount that tries the blob again", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    await pass(tree, store, counter, { now: () => 2_000 });
    tree.write("src/c.ts", "pay 1 B4\n").revise();
    const recount = await pass(tree, store, counter, {
      now: () => 7_000,
      policy: policyOn({ threshold: 10 }),
    });
    expect(recount).toMatchObject({ mode: "threshold", revision: 4 });
    expect(readUncountable(store.meta, tree.id).get(A)).toMatchObject({
      attempts: 2,
      editedAt: 2,
    });
  });

  it("takes the next edit's revision for a new blob", async () => {
    const { tree, store } = await edited();
    const counter = flakyCounter(Infinity);
    await pass(tree, store, counter, { now: () => 2_000 });
    tree.write(A, "settle 24 B5\n").revise();
    await pass(tree, store, counter, { now: () => 3_000 });
    expect(readUncountable(store.meta, tree.id).get(A)).toMatchObject({
      attempts: 1,
      editedAt: 4,
    });
  });

  it("has none for a blob a first count failed on, and none once the file counts", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(A, "settle 23 B2\n").revise();
    expect(await pass(tree, store, flakyCounter(Infinity), { now: () => 1_000 })).toMatchObject({
      mode: "first",
    });
    const first = readUncountable(store.meta, tree.id).get(A);
    expect(first).toMatchObject({ attempts: 1, quiet: true });
    expect(first).not.toHaveProperty("editedAt");
    await pass(tree, store, fakeCounter(), { now: () => 6_000 });
    expect(readUncountable(store.meta, tree.id)).toEqual(new Map());
  });
});
