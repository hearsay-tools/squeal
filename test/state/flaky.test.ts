import { describe, expect, it } from "vitest";
import {
  checkIdentity,
  FLAKY_KEPT,
  FLAKY_META_KEY,
  readFlakyNotes,
  recordFlips,
} from "../../src/core/state/index.js";
import { check, freshStore, OTHER, result, WT } from "./helpers.js";

/*
 * Spec 001 D6 as amended (task 001-170): a check whose stored outcome flips
 * under one key carries a flaky note, kept in `meta` for every worktree.
 */
describe("recordFlips", () => {
  it("notes a fail replaced by a pass and a pass replaced by a fail, under the same key only", () => {
    const store = freshStore();
    const [a, b, c, d] = [check("a"), check("b"), check("c"), check("d")];
    const prior = [
      result(a, "fail", { worktreeId: OTHER }),
      result(b, "pass", { worktreeId: OTHER }),
      result(c, "fail", { worktreeId: OTHER }),
      result(d, "skip", { worktreeId: OTHER }),
    ];
    const next = [
      result(a, "pass"),
      result(b, "fail"),
      result(c, "fail"),
      result(d, "pass"),
      result(a, "fail", { key: "k2" }),
    ];
    const notes = recordFlips(store, prior, next, 7);
    expect(notes).toEqual([
      { key: "k1", from: "fail", to: "pass", fromWorktreeId: OTHER, toWorktreeId: WT, at: 7 },
      { key: "k1", from: "pass", to: "fail", fromWorktreeId: OTHER, toWorktreeId: WT, at: 7 },
    ]);
    expect([...readFlakyNotes(store).keys()]).toEqual([checkIdentity(a), checkIdentity(b)]);
  });

  it("writes nothing without a flip and keeps the newest notes", () => {
    const store = freshStore();
    expect(recordFlips(store, [], [result(check("a"), "pass")], 1)).toEqual([]);
    expect(store.meta.get(FLAKY_META_KEY)).toBeNull();
    const note = { key: "k1", from: "fail", to: "pass", fromWorktreeId: OTHER, toWorktreeId: WT };
    const full = Array.from({ length: FLAKY_KEPT }, (_, n) => [
      checkIdentity(check(`t${n}`)),
      { ...note, at: n },
    ]);
    store.meta.set(FLAKY_META_KEY, JSON.stringify(Object.fromEntries(full)));
    const c = check(`t${FLAKY_KEPT}`);
    recordFlips(store, [result(c, "fail", { worktreeId: OTHER })], [result(c, "pass")], FLAKY_KEPT);
    const kept = readFlakyNotes(store);
    expect(kept.size).toBe(FLAKY_KEPT);
    expect(kept.has(checkIdentity(check("t0")))).toBe(false);
    expect(kept.get(checkIdentity(check(`t${FLAKY_KEPT}`)))?.at).toBe(FLAKY_KEPT);
  });

  it("reads no note from a row that does not parse", () => {
    const store = freshStore();
    store.meta.set(FLAKY_META_KEY, "not json");
    expect(readFlakyNotes(store).size).toBe(0);
  });
});
