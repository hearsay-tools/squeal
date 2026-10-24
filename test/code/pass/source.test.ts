import { describe, expect, it } from "vitest";
import { headAfterMove, mainStoreSource } from "../../../src/core/code/pass/index.js";
import { type CommitSha, headMoveMetaKey } from "../../../src/core/types/index.js";
import { freshStore, WT } from "../../state/helpers.js";

/**
 * A main store holding one revision per head, numbered from 1, and the
 * `HEAD` a reconciliation pass saw move with no file change, when given.
 */
function source(heads: readonly CommitSha[], moved?: { head: CommitSha; revision: number }) {
  const store = freshStore();
  heads.forEach((head, i) => {
    store.revisions.append({
      worktreeId: WT,
      createdAt: i + 1,
      head,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${i + 1}` }],
    });
  });
  if (moved !== undefined) {
    store.meta.set(headMoveMetaKey(WT), JSON.stringify({ ...moved, dirty: false }));
  }
  return mainStoreSource(store, WT, () => []);
}

describe("which revisions moved HEAD, from the main store (015-19)", () => {
  it("gives HEAD at the last revision when one after the cursor moved it", () => {
    const s = source(["a", "a", "b", "b"]);
    expect(s.movedHead(2, 3)).toBe("b");
    expect(s.movedHead(2, 4)).toBe("b");
    expect(s.movedHead(1, 2)).toBeNull();
    expect(s.movedHead(3, 4)).toBeNull();
  });

  it("reads no revision after the last asked for", () => {
    expect(source(["a", "a", "b"]).movedHead(1, 2)).toBeNull();
  });

  it("gives a move away and back as a move, and an unborn HEAD as none", () => {
    const s = source(["a", "b", "a", null]);
    expect(s.movedHead(1, 3)).toBe("a");
    expect(s.movedHead(3, 4)).toBeNull();
  });

  it("takes HEAD at the cursor from a move seen with no file change (task 001-406)", () => {
    // A commit after revision 2: revision 3 at its `HEAD` moved nothing.
    expect(source(["a", "a", "b"], { head: "b", revision: 2 }).movedHead(2, 3)).toBeNull();
    expect(source(["a", "a", "b"], { head: "b", revision: 1 }).movedHead(2, 3)).toBe("b");
  });

  it("at revision 0, compares with the HEAD the daemon first saw, else asks", () => {
    expect(source(["a"], { head: "a", revision: 0 }).movedHead(0, 1)).toBeNull();
    expect(source(["b"], { head: "a", revision: 0 }).movedHead(0, 1)).toBe("b");
    expect(source(["a"]).movedHead(0, 1)).toBe("a");
  });
});

describe("headAfterMove", () => {
  it("is the last head when one differs from the head before it", () => {
    expect(headAfterMove("a", [])).toBeNull();
    expect(headAfterMove("a", ["a", "a"])).toBeNull();
    expect(headAfterMove("a", ["b"])).toBe("b");
    expect(headAfterMove(null, ["a"])).toBe("a");
    expect(headAfterMove("a", ["a", "b", "b"])).toBe("b");
  });

  it("is the last head when the head before is not known", () => {
    expect(headAfterMove(undefined, ["a", "a"])).toBe("a");
    expect(headAfterMove(undefined, [null])).toBeNull();
    expect(headAfterMove(undefined, [])).toBeNull();
  });
});
