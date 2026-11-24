import { describe, expect, it } from "vitest";
import { createStateSink, SCOPED_MAX_FILES } from "../../src/core/state/sink.js";
import type { CheckId, SetupCheckId } from "../../src/core/types/check.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink, Transition } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { check, failure, freshStore, OTHER, result, setKey, WT } from "./helpers.js";

/*
 * Row 025-10 (spec 025 D10, item 3; coordinator agreement 2026-11-24): each
 * sink call reads the known states and key rows of the test files it names,
 * not the whole worktree's, under the write lock. Every call must answer as
 * with the whole worktree's rows: the same states, transitions and returns,
 * setup checks, checks a refresh finds no result for, retired checks and
 * another worktree's states included.
 */

const NONE = { checkpointId: null };
const A: TestFileRef = { project: "", path: "src/a.test.ts" };
const B: TestFileRef = { project: "", path: "src/b.test.ts" };
const C: TestFileRef = { project: "", path: "src/c.test.ts" };
const SETUP: SetupCheckId = { kind: "setup", project: "", testPath: "src/setup.ts" };
const a1 = check("a1", A);
const a2 = check("a2", A);
const a3 = check("a3", A);
const b1 = check("b1", B);
const b2 = check("b2", B);
const c1 = check("c1", C);
const CHECKS: CheckId[] = [a1, a2, a3, b1, b2, c1, SETUP];

/** `store` whose state and key reads ignore any file list: the sink before row 025-10. */
function fullReads(store: Store): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "knownStates") {
        const repo = value as Store["knownStates"];
        return { ...repo, list: (worktreeId: string) => repo.list(worktreeId) };
      }
      if (prop === "testFileKeys") {
        const repo = value as Store["testFileKeys"];
        return { ...repo, list: (worktreeId: string) => repo.list(worktreeId) };
      }
      return value;
    },
  });
}

/** Counts reads of every state or key row of a worktree, with no file list. */
function countingWholeReads(store: Store): { store: Store; whole: string[] } {
  const whole: string[] = [];
  const wrapped = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "knownStates" || prop === "testFileKeys") {
        const repo = value as { list: (w: string, files?: readonly TestFileRef[]) => unknown };
        return {
          ...repo,
          list: (worktreeId: string, files?: readonly TestFileRef[]) => {
            if (files === undefined) whole.push(String(prop));
            return repo.list(worktreeId, files);
          },
        };
      }
      return value;
    },
  });
  return { store: wrapped, whole };
}

/** Every call of the sink a scheduler makes, on a worktree with keys, states and results. */
function scenario(store: Store, sink: StateSink): unknown[] {
  setKey(store, "kA", { file: A });
  setKey(store, "kB", { file: B });
  setKey(store, "kO", { file: A, worktreeId: OTHER });
  store.results.putMany([
    result(a1, "pass", { key: "kA" }),
    result(a2, "fail", { key: "kA" }),
    result(b1, "pass", { key: "kB" }),
  ]);
  const out: unknown[] = [];
  out.push(
    sink.applyResults(
      WT,
      1,
      [a1, a2, a3, b1, b2, c1].map((c) => result(c, c === a2 ? "pass" : "fail", { key: "seed" })),
      NONE,
    ),
  );
  out.push(sink.applyResults(OTHER, 1, [result(a1, "fail", { worktreeId: OTHER })], NONE));
  out.push(sink.setupOutcome(WT, 1, { check: SETUP, commit: null, error: null }));
  out.push(
    sink.applyResults(
      WT,
      2,
      [result(a1, "fail", { key: "kA" }), result(b1, "pass", { key: "kB" })],
      NONE,
    ),
  );
  // a3 has no result under kA: it falls to pending.
  out.push(sink.refresh(WT, 3, NONE, [A]));
  setKey(store, "kA2", { file: A, pending: "queued" });
  out.push(sink.refresh(WT, 4, { checkpointId: "cp" }, [A, B, A]));
  out.push(sink.markUnknown(WT, 5, [B, C], "not run: the run failed to start"));
  out.push(sink.setupOutcome(WT, 6, { check: SETUP, commit: null, error: failure("setup threw") }));
  out.push(sink.setupOutcome(WT, 7, { check: SETUP, commit: null, error: null }));
  sink.retire(WT, [a3]);
  out.push(sink.refresh(WT, 8, NONE, [A, C]));
  out.push(sink.refresh(WT, 9, NONE, []));
  out.push(sink.applyResults(WT, 10, [], NONE));
  out.push(sink.markUnknown(WT, 11, [], "none"));
  out.push(sink.refresh(WT, 12, NONE));
  return out;
}

function snapshot(store: Store, out: unknown[]) {
  const history = (worktreeId: string) =>
    CHECKS.map((c) => store.transitions.history(worktreeId, c) as readonly Transition[]);
  return {
    out,
    states: store.knownStates.list(WT),
    others: store.knownStates.list(OTHER),
    history: history(WT),
    otherHistory: history(OTHER),
  };
}

describe("a sink call reads only the files it names (row 025-10)", () => {
  it("answers every call as a sink reading the whole worktree does", () => {
    const scopedStore = freshStore();
    const scoped = snapshot(
      scopedStore,
      scenario(scopedStore, createStateSink(scopedStore, { now: () => 5_000 })),
    );
    const wholeStore = freshStore();
    const whole = snapshot(
      wholeStore,
      scenario(wholeStore, createStateSink(fullReads(wholeStore), { now: () => 5_000 })),
    );
    expect(scoped).toEqual(whole);
    // The scenario reaches the edges it names.
    expect(
      scoped.states.find((s) => s.check.kind === "test" && s.check.fullName === "a3"),
    ).toBeUndefined();
    expect(scoped.states.find((s) => s.check.kind === "setup")).toMatchObject({ outcome: "pass" });
    expect(
      scoped.states.find((s) => s.check.kind === "test" && s.check.fullName === "c1"),
    ).toMatchObject({
      outcome: "unknown",
    });
    expect(scoped.history.flat().length).toBeGreaterThan(3);
    // a2 passed, then failed under A's key: its earlier state was in the scope.
    expect(scoped.history[CHECKS.indexOf(a2)]?.map((t) => t.kind)).toEqual(["pass-to-fail"]);
  });

  it("never reads the whole worktree for a call that names its files", () => {
    const base = freshStore();
    const { store, whole } = countingWholeReads(base);
    const sink = createStateSink(store, { now: () => 5_000 });
    setKey(base, "kA", { file: A });
    base.results.putMany([result(a1, "pass", { key: "kA" })]);
    sink.applyResults(WT, 1, [result(a1, "fail", { key: "kA" }), result(b1, "pass")], NONE);
    sink.refresh(WT, 2, NONE, [A]);
    sink.markUnknown(WT, 3, [A], "why");
    expect(whole).toEqual([]);
    sink.refresh(WT, 5, NONE);
    expect(whole).toEqual(["knownStates", "testFileKeys"]);
  });

  it("reads the whole worktree past the most files a scoped read takes", () => {
    const base = freshStore();
    const { store, whole } = countingWholeReads(base);
    const many = Array.from({ length: SCOPED_MAX_FILES + 1 }, (_, i) => ({
      project: "",
      path: `src/f${i}.test.ts`,
    }));
    createStateSink(store).refresh(WT, 1, NONE, many);
    expect(whole).toEqual(["knownStates", "testFileKeys"]);
  });
});
