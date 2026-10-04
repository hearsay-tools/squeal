import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStateSink } from "../../src/core/state/index.js";
import type { StateSink, Store } from "../../src/core/types/index.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "./helpers.js";

const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store, { now: () => 5_000 });
  setKey(store, "k1");
});

const kinds = (list: readonly { kind: string }[]) => list.map((t) => t.kind);

describe("applyResults", () => {
  it("records a first-seen fail and derives the known state", () => {
    const a = check("a");
    const recorded = sink.applyResults(WT, 2, [result(a, "fail")], NONE);

    expect(recorded).toEqual([
      {
        worktreeId: WT,
        check: a,
        kind: "first-seen-fail",
        from: null,
        to: "fail",
        fromFingerprint: null,
        toFingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
        revision: 2,
        at: 5_000,
      },
    ]);
    expect(store.transitions.history(WT, a)).toEqual(recorded);
    expect(store.knownStates.get(WT, a)).toEqual({
      worktreeId: WT,
      check: a,
      outcome: "fail",
      validity: "current",
      pendingPhase: null,
      observedAt: 1,
      commit: "c0ffee",
      origin: { kind: "own" },
      durationMs: 5,
      location: { path: "src/a.ts", line: 3, column: 5 },
      summary: "expected 1 to be 2",
      fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
    });
  });

  it("records a first pass silently", () => {
    const a = check("a");
    expect(sink.applyResults(WT, 1, [result(a, "pass")], NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("records each notable kind exactly once", () => {
    const a = check("a");
    const steps = [
      result(a, "pass"),
      result(a, "fail", { message: "one" }),
      result(a, "fail", { message: "one" }),
      result(a, "fail", { message: "two" }),
      result(a, "pass"),
      result(a, "pass"),
    ];
    const all = steps.flatMap((r, i) => sink.applyResults(WT, i + 1, [r], NONE));
    expect(kinds(all)).toEqual(["pass-to-fail", "fail-changed", "fail-to-pass"]);
    expect(kinds(store.transitions.history(WT, a))).toEqual(kinds(all));
  });

  it("never records a skip", () => {
    const a = check("a");
    sink.applyResults(WT, 1, [result(a, "fail")], NONE);
    expect(sink.applyResults(WT, 2, [result(a, "skip")], NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "skip", fingerprint: null });
  });

  it("marks a result from another worktree as inherited", () => {
    const a = check("a");
    sink.applyResults(WT, 1, [result(a, "pass", { worktreeId: OTHER, commit: "beef" })], NONE);
    expect(store.knownStates.get(WT, a)?.origin).toEqual({
      kind: "inherited",
      worktreeId: OTHER,
      commit: "beef",
    });
  });

  it("classifies validity against the file's recorded key", () => {
    const a = check("a");
    sink.applyResults(WT, 1, [result(a, "pass", { key: "old" })], NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({ validity: "stale", pendingPhase: null });

    setKey(store, "k2", { pending: "running" });
    sink.applyResults(WT, 2, [result(a, "pass", { key: "k1" })], NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({
      validity: "pending",
      pendingPhase: "running",
    });

    const b = check("b", { project: "", path: "src/unkeyed.test.ts" });
    sink.applyResults(WT, 2, [result(b, "pass")], NONE);
    expect(store.knownStates.get(WT, b)?.validity).toBe("stale");
  });

  it("derives a fingerprint when a fail result has none", () => {
    const a = check("a");
    const bare = { ...result(a, "fail"), fingerprint: null, summary: null };
    sink.applyResults(WT, 1, [bare], NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({
      fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
      summary: "expected 1 to be 2",
    });
  });

  it("keeps worktrees apart", () => {
    const a = check("a");
    setKey(store, "k1", { worktreeId: OTHER });
    sink.applyResults(WT, 1, [result(a, "pass")], NONE);
    expect(kinds(sink.applyResults(OTHER, 1, [result(a, "fail")], NONE))).toEqual([
      "first-seen-fail",
    ]);
    expect(store.knownStates.get(WT, a)?.outcome).toBe("pass");
  });
});

describe("markUnknown", () => {
  it("turns every known check of the files unknown and records pass and fail ones", () => {
    const [a, b, c] = [check("a"), check("b"), check("c")];
    const elsewhere = check("d", { project: "", path: "src/d.test.ts" });
    sink.applyResults(
      WT,
      1,
      [result(a, "pass"), result(b, "fail"), result(c, "skip"), result(elsewhere, "pass")],
      NONE,
    );

    const recorded = sink.markUnknown(WT, 2, [FILE], "runner crashed: worker exited");
    expect(recorded.map((t) => [t.check, t.kind, t.from])).toEqual([
      [a, "to-unknown", "pass"],
      [b, "to-unknown", "fail"],
    ]);
    expect(store.knownStates.get(WT, c)).toMatchObject({ outcome: "unknown", validity: "unknown" });
    expect(store.knownStates.get(WT, a)).toMatchObject({
      outcome: "unknown",
      validity: "unknown",
      observedAt: 2,
      summary: "runner crashed: worker exited",
      fingerprint: null,
    });
    expect(store.knownStates.get(WT, elsewhere)?.outcome).toBe("pass");
  });

  it("records nothing for a check that is already unknown", () => {
    sink.applyResults(WT, 1, [result(check("a"), "pass")], NONE);
    sink.markUnknown(WT, 2, [FILE], "timed out");
    expect(sink.markUnknown(WT, 3, [FILE], "timed out")).toEqual([]);
  });
});

describe("refresh", () => {
  it("turns states of a changed key stale or pending without a transition", () => {
    const a = check("a");
    sink.applyResults(WT, 1, [result(a, "fail")], NONE);

    setKey(store, "k2");
    expect(sink.refresh(WT, 2, NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)).toMatchObject({ outcome: "fail", validity: "stale" });

    setKey(store, "k2", { pending: "queued" });
    sink.refresh(WT, 2, NONE);
    expect(store.knownStates.get(WT, a)).toMatchObject({
      outcome: "fail",
      validity: "pending",
      pendingPhase: "queued",
      fingerprint: "AssertionError: expected 1 to be 2 @ src/a.ts:3:5",
    });
  });

  it("takes results stored under the current key, as a lookup hit", () => {
    const [a, b] = [check("a"), check("b")];
    store.results.putMany([
      result(a, "pass", { key: "k1", worktreeId: OTHER }),
      result(b, "fail", { key: "k1", worktreeId: OTHER }),
    ]);

    const recorded = sink.refresh(WT, 3, NONE);
    expect(recorded.map((t) => [t.check, t.kind])).toEqual([[b, "first-seen-fail"]]);
    expect(store.knownStates.get(WT, a)).toMatchObject({
      outcome: "pass",
      validity: "current",
      observedAt: 3,
      origin: { kind: "inherited", worktreeId: OTHER, commit: "c0ffee" },
    });
  });

  it("is idempotent and keeps the revision an inherited result was first seen at", () => {
    const a = check("a");
    store.results.putMany([result(a, "fail", { key: "k1", worktreeId: OTHER })]);
    sink.refresh(WT, 3, NONE);
    expect(sink.refresh(WT, 4, NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)?.observedAt).toBe(3);
  });

  it("writes no known state when a refresh derives the same one, in any property order", () => {
    const [a, b] = [check("a"), check("b")];
    const results = [result(a, "fail", { key: "k1", worktreeId: OTHER }), result(b, "pass")];
    store.results.putMany(results);
    sink.applyResults(WT, 1, results, NONE);
    // A decoder may build the same state with its properties in another order.
    const list = store.knownStates.list.bind(store.knownStates);
    const reorder = <T extends object>(o: T): T =>
      Object.fromEntries(
        Object.entries(o)
          .reverse()
          .map(([k, v]) => [k, v !== null && typeof v === "object" ? reorder(v) : v]),
      ) as T;
    vi.spyOn(store.knownStates, "list").mockImplementation((id) => list(id).map(reorder));
    const upserts = vi.spyOn(store.knownStates, "upsertMany");
    sink.refresh(WT, 1, NONE);
    expect(upserts.mock.calls.flatMap(([states]) => states)).toEqual([]);
  });

  it("returns a check to current when its key comes back", () => {
    const a = check("a");
    store.results.putMany([result(a, "pass", { key: "k1" })]);
    sink.applyResults(WT, 1, [result(a, "pass", { key: "k1" })], NONE);
    setKey(store, "k2");
    sink.refresh(WT, 2, NONE);
    setKey(store, "k1");
    expect(sink.refresh(WT, 3, NONE)).toEqual([]);
    expect(store.knownStates.get(WT, a)?.validity).toBe("current");
  });

  it("limits the work to the given test files", () => {
    const other = { project: "", path: "src/b.test.ts" };
    const [a, b] = [check("a"), check("b", other)];
    setKey(store, "k1", { file: other });
    sink.applyResults(WT, 1, [result(a, "pass"), result(b, "pass")], NONE);
    setKey(store, "k2");
    setKey(store, "k2", { file: other });

    sink.refresh(WT, 2, NONE, [other]);
    expect(store.knownStates.get(WT, a)?.validity).toBe("current");
    expect(store.knownStates.get(WT, b)?.validity).toBe("stale");
  });

  it("leaves unkeyed test files alone", () => {
    const other = { project: "", path: "src/gone.test.ts" };
    const a = check("a", other);
    sink.applyResults(WT, 1, [result(a, "pass")], NONE);
    sink.refresh(WT, 2, NONE);
    expect(store.knownStates.get(WT, a)?.validity).toBe("stale");
  });
});

describe("retire", () => {
  it("removes known states and every consumer view entry of the checks", () => {
    const [a, b] = [check("a"), check("b")];
    sink.applyResults(WT, 1, [result(a, "fail"), result(b, "pass")], NONE);
    const consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
    store.consumers.register(consumer, 1);
    store.views.writeMany(consumer, [
      { check: a, outcome: "fail", fingerprint: "x", toldAt: 1 },
      { check: b, outcome: "pass", fingerprint: null, toldAt: 1 },
    ]);

    sink.retire(WT, [a]);
    expect(store.knownStates.list(WT).map((s) => s.check)).toEqual([b]);
    expect(store.views.list(consumer).map((v) => v.check)).toEqual([b]);
  });
});
