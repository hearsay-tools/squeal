import { describe, expect, it } from "vitest";
import type { CodeKnownState, CodeTransition, CodeViewEntry } from "../../src/core/types/code.js";
import { check, commonDir, count, file, open } from "./helpers.js";

function state(worktreeId: string, qualifiedName: string, over: Partial<CodeKnownState> = {}) {
  return {
    worktreeId,
    check: check(qualifiedName),
    measure: "complexity",
    outcome: "fail",
    value: 23,
    threshold: 20,
    countedAt: 4,
    blob: "b1",
    changedAt: 3,
    ...over,
  } satisfies CodeKnownState;
}

const ALICE = { worktreeId: "w1", sessionId: "s1", agentId: "main" };

describe("code store repositories (015 D4)", () => {
  it("reads a count one worktree stored from another worktree's connection", () => {
    const dir = commonDir();
    const first = open(dir);
    first.files.upsertMany("w1", [file("src/a.ts", "b1")]);
    first.counts.put(count("b1", 23), 1_000);

    const second = open(dir);
    second.files.upsertMany("w2", [file("lib/moved.ts", "b1")]);
    expect(second.files.uncounted("w2")).toEqual([]);
    expect(second.counts.get("b1", "typescript", 1)).toEqual(count("b1", 23));
    // The key holds the language and the counter version, never a path.
    expect(second.counts.get("b1", "javascript", 1)).toBeNull();
    expect(second.counts.get("b1", "typescript", 2)).toBeNull();
  });

  it("keeps the first count stored under a key", () => {
    const store = open(commonDir());
    store.counts.put(count("b1", 3), 1_000);
    store.counts.put(count("b1", 9), 2_000);
    expect(store.counts.get("b1", "typescript", 1)?.functions[0]?.complexity).toBe(3);
  });

  it("lists each worktree's files, those still to count, and drops removed paths", () => {
    const store = open(commonDir());
    store.files.upsertMany("w1", [file("src/b.ts", "b2"), file("src/a.ts", "b1")]);
    store.files.upsertMany("w2", [file("src/a.ts", "b9")]);
    store.counts.put(count("b1"), 1_000);
    expect(store.files.list("w1").map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(store.files.uncounted("w1")).toEqual([file("src/b.ts", "b2")]);
    // A file at a new blob, or counted by another counter version, is to count again.
    store.files.upsertMany("w1", [file("src/a.ts", "b1", 2, 5)]);
    expect(store.files.list("w1", ["src/a.ts"])).toEqual([file("src/a.ts", "b1", 2, 5)]);
    expect(store.files.uncounted("w1").map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    store.files.removeMany("w1", ["src/b.ts"]);
    expect(store.files.list("w1").map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(store.files.list("w2")).toEqual([file("src/a.ts", "b9")]);
  });

  it("keeps a state per worktree, check and measure, and filters it", () => {
    const store = open(commonDir());
    const fail = state("w1", "Ledger.settle");
    const pass = state("w1", "Ledger.open", { outcome: "pass", value: 4 });
    const crap = state("w1", "Ledger.settle", { measure: "crap", value: 31.5, threshold: 30 });
    store.states.upsertMany([fail, pass, crap, state("w2", "Ledger.settle", { value: 40 })]);
    expect(store.states.list("w1")).toEqual([pass, fail, crap]);
    expect(store.states.list("w1", { outcome: "fail", measure: "complexity" })).toEqual([fail]);
    expect(store.states.list("w1", { paths: ["src/other.ts"] })).toEqual([]);
    const healed = { ...fail, outcome: "pass", value: 18, countedAt: 6, changedAt: 6 } as const;
    store.states.upsertMany([healed]);
    expect(store.states.list("w1", { measure: "complexity", outcome: "pass" })).toEqual([
      pass,
      healed,
    ]);
    store.states.removeMany("w1", [check("Ledger.settle")]);
    expect(store.states.list("w1")).toEqual([pass]);
    expect(store.states.list("w2")).toHaveLength(1);
  });

  // Row 015-45: read by path, from each path's checks, not by a scan of the worktree's states.
  it("lists the states of the paths it is given, each once and in order", () => {
    const store = open(commonDir());
    const on = (path: string, name: string, over: Partial<CodeKnownState> = {}) =>
      state("w1", name, { check: { ...check(name), path }, ...over });
    const states = [
      on("src/c.ts", "c"),
      on("src/a.ts", "a2"),
      on("src/a.ts", "a1"),
      on("src/a.ts", "a1", { measure: "crap", outcome: "pass", value: 3 }),
      on("src/b.ts", "b"),
      state("w2", "a1", { check: { ...check("a1"), path: "src/a.ts" } }),
    ];
    store.states.upsertMany(states);
    const all = store.states.list("w1");
    const of = (...paths: string[]) => all.filter((s) => paths.includes(s.check.path));
    expect(store.states.list("w1", { paths: ["src/b.ts", "src/a.ts", "src/a.ts"] })).toEqual(
      of("src/a.ts", "src/b.ts"),
    );
    expect(store.states.list("w1", { paths: ["src/a.ts"], measure: "crap" })).toEqual(
      of("src/a.ts").filter((s) => s.measure === "crap"),
    );
    expect(store.states.list("w1", { paths: ["src/a.ts", "src/c.ts"], outcome: "fail" })).toEqual(
      of("src/a.ts", "src/c.ts").filter((s) => s.outcome === "fail"),
    );
    expect(store.states.list("w1", { paths: [] })).toEqual([]);
    expect(store.states.list("w2", { paths: ["src/a.ts"] })).toHaveLength(1);
    const edit = (name: string, path: string) => ({
      check: { ...check(name), path },
      measure: "complexity" as const,
      revision: 5,
      at: 1_000,
    });
    store.states.markEdited("w1", [
      edit("a1", "src/a.ts"),
      edit("b", "src/b.ts"),
      edit("c", "src/c.ts"),
    ]);
    const edits = store.states.edits("w1", "complexity");
    expect(edits.map((e) => e.check.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(store.states.edits("w1", "complexity", ["src/c.ts", "src/a.ts", "src/a.ts"])).toEqual(
      edits.filter((e) => e.check.path !== "src/b.ts"),
    );
    expect(store.states.edits("w1", "crap", ["src/a.ts"])).toEqual([]);
  });

  it("moves a check's states and every view entry to its new identity (D2)", () => {
    const store = open(commonDir());
    const moved = check("settle", "src/ledger/settle.ts");
    store.states.upsertMany([state("w1", "Ledger.settle"), state("w2", "Ledger.settle")]);
    const told: CodeViewEntry = {
      check: check("Ledger.settle"),
      measure: "complexity",
      outcome: "fail",
      threshold: 20,
      told: "count",
      toldAt: 7,
    };
    store.views.writeMany(ALICE, [told]);
    store.states.move("w1", check("Ledger.settle"), moved);
    expect(store.states.list("w1")).toEqual([{ ...state("w1", "Ledger.settle"), check: moved }]);
    expect(store.views.list(ALICE)).toEqual([{ ...told, check: moved }]);
    // Another worktree's state of the old identity stays where it was.
    expect(store.states.list("w2").map((s) => s.check)).toEqual([check("Ledger.settle")]);
  });

  it("moves a check's transitions with it, at their revision and time, and records none (D2)", () => {
    const store = open(commonDir());
    const moved = check("settle", "src/ledger/settle.ts");
    const crossing = (worktreeId: string, revision: number, at: number): CodeTransition => ({
      worktreeId,
      check: check("Ledger.settle"),
      measure: "complexity",
      kind: "pass-to-fail",
      from: "pass",
      to: "fail",
      fromValue: 18,
      toValue: 23,
      threshold: 20,
      revision,
      at,
    });
    // An earlier function at the new identity, removed: its history is not the moved one's.
    const stale: CodeTransition = {
      ...crossing("w1", 3, 30),
      check: moved,
      kind: "removed",
      from: "fail",
      to: null,
      toValue: null,
    };
    store.states.upsertMany([state("w1", "Ledger.settle"), state("w2", "Ledger.settle")]);
    store.transitions.append([stale, crossing("w1", 2, 20), crossing("w2", 2, 21)]);
    store.states.move("w1", check("Ledger.settle"), moved);
    expect(store.transitions.history("w1", moved)).toEqual([
      { ...crossing("w1", 2, 20), check: moved },
    ]);
    expect(store.transitions.history("w1", check("Ledger.settle"))).toEqual([]);
    expect(store.transitions.history("w2", check("Ledger.settle"))).toEqual([
      crossing("w2", 2, 21),
    ]);
  });

  it("appends transitions and reads one check's history, oldest first", () => {
    const store = open(commonDir());
    const base = {
      worktreeId: "w1",
      check: check("Ledger.settle"),
      measure: "complexity",
      threshold: 20,
      at: 9,
    } as const;
    const history: CodeTransition[] = [
      {
        ...base,
        kind: "first-seen-fail",
        from: null,
        to: "fail",
        fromValue: null,
        toValue: 23,
        revision: 2,
      },
      {
        ...base,
        kind: "fail-to-pass",
        from: "fail",
        to: "pass",
        fromValue: 23,
        toValue: 18,
        revision: 3,
      },
      {
        ...base,
        kind: "pass-to-fail",
        from: "pass",
        to: "fail",
        fromValue: 18,
        toValue: 21,
        revision: 4,
      },
      {
        ...base,
        kind: "removed",
        from: "fail",
        to: null,
        fromValue: 21,
        toValue: null,
        revision: 5,
      },
    ];
    store.transitions.append(history);
    expect(store.transitions.history("w1", check("Ledger.settle"))).toEqual(history);
    expect(store.transitions.history("w2", check("Ledger.settle"))).toEqual([]);
    expect(store.transitions.history("w1", check("nothing"))).toEqual([]);
  });

  it("keeps each consumer's view, told by count or in full, and clears it", () => {
    const store = open(commonDir());
    const bob = { ...ALICE, agentId: "sub-1" };
    const entry: CodeViewEntry = {
      check: check("Ledger.settle"),
      measure: "complexity",
      outcome: "fail",
      threshold: 20,
      told: "count",
      toldAt: 7,
    };
    store.views.writeMany(ALICE, [entry]);
    store.views.writeMany(bob, [entry]);
    store.views.writeMany(ALICE, [{ ...entry, told: "full", toldAt: 8 }]);
    expect(store.views.list(ALICE)).toEqual([{ ...entry, told: "full", toldAt: 8 }]);
    store.views.clear(ALICE);
    expect(store.views.list(ALICE)).toEqual([]);
    expect(store.views.list(bob)).toEqual([entry]);
  });

  it("keeps meta entries", () => {
    const store = open(commonDir());
    store.meta.set("k", "v1");
    store.meta.set("k", "v2");
    expect(store.meta.get("k")).toBe("v2");
    store.meta.delete("k");
    expect(store.meta.get("k")).toBeNull();
  });
});
