import { describe, expect, it } from "vitest";
import type { CodeKnownState } from "../../src/core/types/code.js";
import { check, commonDir, open } from "./helpers.js";

/*
 * Row 015-48: a pass stages its states in parts under another worktree id,
 * and one transaction makes them the worktree's.
 */

const STAGED = "w1 recount";

function state(
  worktreeId: string,
  qualifiedName: string,
  over: Partial<CodeKnownState> = {},
): CodeKnownState {
  return {
    worktreeId,
    check: check(qualifiedName),
    measure: "complexity",
    outcome: "pass",
    value: 3,
    threshold: 20,
    countedAt: 4,
    blob: "b1",
    changedAt: 3,
    ...over,
  };
}

const rows = (store: ReturnType<typeof open>, worktreeId: string) =>
  store.states
    .list(worktreeId)
    .map((s) => `${s.check.qualifiedName} ${s.measure} ${s.outcome} ${s.value} ${s.countedAt}`);

describe("adopting staged states (row 015-48)", () => {
  it("writes each staged state over the worktree's, keeps its last edit and other measures, and counts them", () => {
    const store = open(commonDir());
    store.states.upsertMany([
      state("w1", "kept"),
      state("w1", "kept", { measure: "crap", outcome: "pending", value: null }),
      state("w2", "kept"),
    ]);
    store.states.markEdited("w1", [
      { check: check("kept"), measure: "complexity", revision: 4, at: 4_000 },
    ]);
    store.states.upsertMany([
      state(STAGED, "kept", { outcome: "fail", value: 25, countedAt: 9 }),
      state(STAGED, "added", { countedAt: 9 }),
    ]);

    expect(store.states.adopt("w1", STAGED, "complexity", [])).toBe(2);
    expect(rows(store, "w1")).toEqual([
      "added complexity pass 3 9",
      "kept complexity fail 25 9",
      "kept crap pending null 4",
    ]);
    expect(store.states.edits("w1", "complexity").map((e) => e.at)).toEqual([4_000]);
    // Another worktree's states and the staged rows stay.
    expect(rows(store, "w2")).toEqual(["kept complexity pass 3 4"]);
    expect(rows(store, STAGED)).toHaveLength(2);
  });

  it("removes every measure's state of each removed check", () => {
    const store = open(commonDir());
    store.states.upsertMany([
      state("w1", "gone"),
      state("w1", "gone", { measure: "uncovered", outcome: "fail", value: null }),
      state("w1", "stays"),
      state(STAGED, "stays", { countedAt: 9 }),
    ]);

    expect(store.states.adopt("w1", STAGED, "complexity", [check("gone"), check("never")])).toBe(1);
    expect(rows(store, "w1")).toEqual(["stays complexity pass 3 9"]);
  });

  it("writes nothing when nothing is staged", () => {
    const store = open(commonDir());
    store.states.upsertMany([state("w1", "kept")]);

    expect(store.states.adopt("w1", STAGED, "complexity", [])).toBe(0);
    expect(rows(store, "w1")).toEqual(["kept complexity pass 3 4"]);
  });
});
