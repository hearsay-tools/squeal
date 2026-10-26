import { describe, expect, it } from "vitest";
import type { LintTransition } from "../../../src/core/types/lint.js";
import { check, commonDir, finding, open } from "../helpers.js";

/* Spec 017 D8: the transition reads a consumer's told mark stands on: row ids, in write order. */

function transition(path: string, revision: number, worktreeId = "w1"): LintTransition {
  return {
    worktreeId,
    check: check(path),
    kind: "pass-to-fail",
    added: [finding("no-undef", "x is not defined")],
    removed: [],
    revision,
    at: 1_000 + revision,
  };
}

describe("lint transitions by id (017 D8)", () => {
  it("lists the worktree's transitions after an id, the last of each check, and the newest id", () => {
    const store = open(commonDir());
    expect(store.transitions.lastId("w1")).toBe(0);
    expect(store.transitions.after("w1", 0)).toEqual([]);
    store.transitions.append([transition("src/a.js", 1), transition("src/b.js", 1)]);
    store.transitions.append([transition("src/x.js", 1, "w2")]);
    store.transitions.append([transition("src/a.js", 2)]);

    const all = store.transitions.after("w1", 0);
    expect(all.map((t) => [t.id, t.check.path, t.revision])).toEqual([
      [1, "src/a.js", 1],
      [2, "src/b.js", 1],
      [4, "src/a.js", 2],
    ]);
    expect(store.transitions.after("w1", 2).map((t) => t.id)).toEqual([4]);
    expect(store.transitions.lastId("w1")).toBe(4);
    expect(store.transitions.lastId("w2")).toBe(3);
    expect(store.transitions.latest("w1").map((t) => [t.check.path, t.revision])).toEqual([
      ["src/b.js", 1],
      ["src/a.js", 2],
    ]);
    // The record is the stored transition with its id.
    const { id, ...rest } = all[0] as (typeof all)[number];
    expect(rest).toEqual(transition("src/a.js", 1));
    expect(id).toBe(1);
  });
});
