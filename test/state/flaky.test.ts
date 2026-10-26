import { describe, expect, it } from "vitest";
import {
  checkIdentity,
  FLAKY_KEPT,
  FLAKY_META_KEY,
  flakyText,
  readFlakyNotes,
  recordFlips,
} from "../../src/core/state/index.js";
import type { FlakyNote } from "../../src/core/types/index.js";
import { check, freshStore, OTHER, result, WT } from "./helpers.js";

/*
 * Spec 001 D6 as amended (task 001-170): a check whose stored outcome flips
 * under one key carries a flaky note, kept in `meta` for every worktree.
 */
describe("recordFlips", () => {
  it("notes a fail replaced by a pass with its error, and a pass replaced by a fail, under the same key only", () => {
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
      // The replaced fail's summary stays, so `why` keeps the first error (task 011-19).
      {
        key: "k1",
        from: "fail",
        to: "pass",
        fromWorktreeId: OTHER,
        toWorktreeId: WT,
        at: 7,
        failure: "expected 1 to be 2",
        // Row 011-253: the check had no note at k1, so no pass there is on record before the FAIL.
        noEarlierPass: true,
      },
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

  // Row 011-253 (gh-103): a later pass says whether a pass at the key came before the FAIL.
  describe("a fail -> pass note's earlier pass at its key", () => {
    const a = check("a");
    const recover = (store: ReturnType<typeof freshStore>, at: number) =>
      recordFlips(store, [result(a, "fail")], [result(a, "pass")], at)[0];

    it("names none on record when the check has no note", () => {
      expect(recover(freshStore(), 7)).toMatchObject({ from: "fail", noEarlierPass: true });
    });

    it("names none on record when the check's note is at another key", () => {
      const store = freshStore();
      recordFlips(store, [result(a, "pass", { key: "k0" })], [result(a, "fail", { key: "k0" })], 5);
      expect(recover(store, 7)).toMatchObject({ key: "k1", noEarlierPass: true });
    });

    it("names none when a note at its key came first, either way", () => {
      const store = freshStore();
      recordFlips(store, [result(a, "pass")], [result(a, "fail")], 5);
      expect(recover(store, 7)).not.toHaveProperty("noEarlierPass");
      recordFlips(store, [result(a, "pass")], [result(a, "fail")], 8);
      expect(recover(store, 9)).not.toHaveProperty("noEarlierPass");
    });

    it("never marks a pass -> fail note, and keeps the mark through a read", () => {
      const store = freshStore();
      const [broke] = recordFlips(store, [result(a, "pass")], [result(a, "fail")], 5);
      expect(broke).not.toHaveProperty("noEarlierPass");
      const fresh = freshStore();
      recover(fresh, 7);
      expect(readFlakyNotes(fresh).get(checkIdentity(a))?.noEarlierPass).toBe(true);
    });

    it("reads a mark that is not true as no mark", () => {
      const store = freshStore();
      const note = { key: "k1", from: "fail", to: "pass", fromWorktreeId: OTHER, toWorktreeId: WT };
      store.meta.set(
        FLAKY_META_KEY,
        JSON.stringify({ x: { ...note, at: 1, noEarlierPass: false } }),
      );
      const read = readFlakyNotes(store).get("x");
      expect(read).toBeDefined();
      expect(flakyText(read as FlakyNote)).toBe(
        "flaky: FAIL -> PASS under the same tracked inputs",
      );
    });
  });

  it("reads no note from a row that does not parse", () => {
    const store = freshStore();
    store.meta.set(FLAKY_META_KEY, "not json");
    expect(readFlakyNotes(store).size).toBe(0);
  });
});
