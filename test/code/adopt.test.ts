import { describe, expect, it } from "vitest";
import { isStagedId, stagedId } from "../../src/core/code/store/index.js";
import type { CodeKnownState, CodeTransition } from "../../src/core/types/code.js";
import { check, commonDir, open } from "./helpers.js";

/*
 * Row 015-48: a pass stages its states in parts under another worktree id,
 * and one transaction makes them the worktree's. Row 015-55: an edit pass
 * stages its edit marks and transitions too.
 */

const STAGED = stagedId("w1");

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

function transition(
  worktreeId: string,
  qualifiedName: string,
  over: Partial<CodeTransition> = {},
): CodeTransition {
  return {
    worktreeId,
    check: check(qualifiedName),
    measure: "complexity",
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    fromValue: 3,
    toValue: 25,
    threshold: 20,
    revision: 9,
    at: 9_000,
    ...over,
  };
}

const history = (store: ReturnType<typeof open>, worktreeId: string, name: string) =>
  store.transitions.history(worktreeId, check(name)).map((t) => `${t.kind} ${t.revision}`);

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

describe("an edit pass's staged edits and transitions (row 015-55)", () => {
  it("adopts a staged edit mark, on a new state too, and keeps a state's own when none is staged", () => {
    const store = open(commonDir());
    store.states.upsertMany([state("w1", "edited"), state("w1", "kept")]);
    store.states.markEdited("w1", [
      { check: check("edited"), measure: "complexity", revision: 4, at: 4_000 },
      { check: check("kept"), measure: "complexity", revision: 4, at: 4_000 },
    ]);
    store.states.upsertMany([
      state(STAGED, "edited", { countedAt: 9 }),
      state(STAGED, "kept", { countedAt: 9 }),
      state(STAGED, "added", { countedAt: 9 }),
    ]);
    store.states.markEdited(STAGED, [
      { check: check("edited"), measure: "complexity", revision: 9, at: 9_000 },
      { check: check("added"), measure: "complexity", revision: 9, at: 9_000 },
    ]);

    expect(store.states.adopt("w1", STAGED, "complexity", [])).toBe(3);
    expect(
      store.states.edits("w1", "complexity").map((e) => `${e.check.qualifiedName} ${e.revision}`),
    ).toEqual(["added 9", "edited 9", "kept 4"]);
  });

  it("copies the staged transitions in their order under new ids, after one the worktree got meanwhile", () => {
    const store = open(commonDir());
    store.transitions.append([transition("w1", "f", { kind: "first-seen-fail", revision: 2 })]);
    store.transitions.append([
      transition(STAGED, "f", { kind: "fail-to-pass", revision: 9 }),
      transition(STAGED, "f", { kind: "pass-to-fail", revision: 9 }),
      transition(STAGED, "g", { revision: 9 }),
    ]);
    store.transitions.append([transition("w1", "f", { kind: "removed", revision: 5 })]);

    expect(store.transitions.adopt("w1", STAGED, 3)).toBe(3);
    expect(history(store, "w1", "f")).toEqual([
      "first-seen-fail 2",
      "removed 5",
      "fail-to-pass 9",
      "pass-to-fail 9",
    ]);
    expect(history(store, "w1", "g")).toEqual(["pass-to-fail 9"]);
    // The staged rows stay until the pass drops them.
    expect(history(store, STAGED, "f")).toHaveLength(2);
    store.transitions.dropStaged(STAGED);
    expect(history(store, STAGED, "f")).toEqual([]);
    expect(history(store, "w1", "f")).toHaveLength(4);
  });

  it("copies none when the staged count is not the one expected", () => {
    const store = open(commonDir());
    store.transitions.append([transition(STAGED, "f"), transition(STAGED, "g")]);

    expect(store.transitions.adopt("w1", STAGED, 3)).toBe(0);
    expect(history(store, "w1", "f")).toEqual([]);
    expect(store.transitions.adopt("w1", STAGED, 0)).toBe(0);
    expect(history(store, "w1", "g")).toEqual([]);
  });

  it("drops staged transitions only: a worktree's own audit log is refused", () => {
    const store = open(commonDir());
    store.transitions.append([transition("w1", "f")]);

    expect(isStagedId(STAGED)).toBe(true);
    expect(isStagedId("0123456789abcdef")).toBe(false);
    expect(() => store.transitions.dropStaged("w1")).toThrow(/no staging id/);
    expect(history(store, "w1", "f")).toEqual(["pass-to-fail 9"]);
  });
});
