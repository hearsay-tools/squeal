import { describe, expect, it } from "vitest";
import { type WriteKind, WriteQueue } from "../../src/core/store-process/queue.js";

/*
 * Spec 021 D22.3 (row 021-36), done-when (6): a worktree's batches in
 * order, edit-tier results first, the prune last and only when nothing
 * else waits.
 */

/** Writes every batch in the queue's order; the names of the batches. */
function order(pushes: readonly (readonly [string, WriteKind, string])[]): string[] {
  const queue = new WriteQueue<string>();
  for (const [worktree, kind, name] of pushes) queue.push(worktree, kind, name);
  const written: string[] = [];
  for (let next = queue.peek(); next !== null; next = queue.peek()) {
    written.push(next.item);
    queue.remove(next);
  }
  expect(queue.size).toBe(0);
  return written;
}

describe("the store process's write queue", () => {
  it("keeps one worktree's batches in the order they came", () => {
    expect(
      order([
        ["w1", "record", "a1"],
        ["w1", "edit", "a2"],
        ["w1", "record", "a3"],
      ]),
    ).toEqual(["a1", "a2", "a3"]);
  });

  it("writes another worktree's edit-tier batch before records that came first", () => {
    expect(
      order([
        ["w1", "record", "a1"],
        ["w2", "record", "b1"],
        ["w3", "edit", "c1"],
        ["w2", "edit", "b2"],
      ]),
    ).toEqual(["c1", "a1", "b1", "b2"]);
  });

  it("writes the prune last, only when nothing else waits", () => {
    expect(
      order([
        ["w1", "prune", "p"],
        ["w2", "record", "b1"],
        ["w3", "edit", "c1"],
        ["w2", "record", "b2"],
      ]),
    ).toEqual(["c1", "b1", "b2", "p"]);
  });

  it("writes a prune that leads its worktree when only prunes lead, so its worktree's order holds", () => {
    expect(
      order([
        ["w1", "prune", "p"],
        ["w1", "edit", "a1"],
      ]),
    ).toEqual(["p", "a1"]);
  });

  it("keeps a batch cut into slices at its worktree's head, with other worktrees' edits between", () => {
    const queue = new WriteQueue<string>();
    queue.push("w1", "record", "long");
    queue.push("w1", "record", "after");
    const first = queue.peek();
    expect(first?.item).toBe("long");
    // A slice of `long` ran; an edit of w2 came meanwhile.
    queue.push("w2", "edit", "edit");
    expect(queue.peek()?.item).toBe("edit");
    queue.remove(queue.peek() as never);
    expect(queue.peek()?.item).toBe("long");
  });

  it("drains every batch for a stop", () => {
    const queue = new WriteQueue<string>();
    queue.push("w1", "record", "a");
    queue.push("w2", "prune", "b");
    expect(queue.drain().sort()).toEqual(["a", "b"]);
    expect(queue.peek()).toBeNull();
  });
});
