import { describe, expect, it } from "vitest";
import { Checkpoints } from "../../src/core/scheduler/checkpoints.js";
import {
  checkpointMetaKey,
  parseCheckpointProgress,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

const a: TestFileRef = { project: "", path: "test/a.test.ts" };
const b: TestFileRef = { project: "", path: "test/b.test.ts" };

function tracker() {
  const store = open(fakeCommonDir());
  let now = 100;
  return { store, checkpoints: new Checkpoints(store, "wt", () => now++) };
}

describe("Checkpoints (D7)", () => {
  it("completes once every requested test file got a result", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "baseline", 3, [a, b]);
    expect(checkpoints.idFor(a)).toBe("cp-1");
    checkpoints.done(a, null);
    expect(store.checkpoints.get("cp-1")?.end).toBeNull();
    expect(checkpoints.active?.remaining).toBe(1);
    checkpoints.done(b, "cp-1");
    expect(store.checkpoints.get("cp-1")).toMatchObject({ end: "completed", revision: 3 });
    expect(checkpoints.active).toBeNull();
    expect(checkpoints.idFor(a)).toBeNull();
  });

  it("completes at once with nothing to run", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "run-all", 1, []);
    expect(store.checkpoints.lastCompleted("wt")?.id).toBe("cp-1");
  });

  it("is abandoned when a file crashed, and when a newer request replaces it", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "baseline", 1, [a, b]);
    checkpoints.failed(a);
    checkpoints.done(b, null);
    expect(store.checkpoints.get("cp-1")?.end).toBe("abandoned");

    checkpoints.start("cp-2", "run-all", 2, [a]);
    checkpoints.start("cp-3", "run-all", 2, [a]);
    expect(store.checkpoints.get("cp-2")?.end).toBe("abandoned");
    expect(checkpoints.active?.record.id).toBe("cp-3");
  });

  it("when strict (run --all --force), counts only results of its own tiers", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "run-all", 1, [a], true);
    checkpoints.done(a, null);
    checkpoints.done(a, "cp-0");
    expect(store.checkpoints.get("cp-1")?.end).toBeNull();
    checkpoints.done(a, "cp-1");
    expect(store.checkpoints.get("cp-1")?.end).toBe("completed");
  });
});

describe("Checkpoints: join, owe and resume (tasks 001-217, 001-219)", () => {
  const progress = (store: ReturnType<typeof tracker>["store"]) =>
    parseCheckpointProgress(store.meta.get(checkpointMetaKey("wt")));

  it("keeps the open checkpoint's progress in meta, and clears it once it ends", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "baseline", 3, [a, b]);
    expect(progress(store)).toMatchObject({ id: "cp-1", kind: "baseline", done: 0, total: 2 });
    checkpoints.done(a, "cp-1");
    expect(progress(store)).toMatchObject({ done: 1, total: 2, revision: 3 });
    checkpoints.done(b, "cp-1");
    expect(store.meta.get(checkpointMetaKey("wt"))).toBe("");
  });

  it("a joined request ends with the open checkpoint, which stays open", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "baseline", 1, [a, b]);
    expect(checkpoints.covers([a], false)).toBe(true);
    expect(checkpoints.covers([a], true)).toBe(false);
    checkpoints.join("cp-2", "run-all", 2, [a]);
    expect(checkpoints.active).toMatchObject({ record: { id: "cp-1" }, explicit: true });
    expect(checkpoints.idFor(a)).toBe("cp-1");
    expect(progress(store)).toMatchObject({ id: "cp-1", kind: "run-all" });
    checkpoints.done(a, "cp-1");
    checkpoints.done(b, "cp-1");
    expect(store.checkpoints.get("cp-1")?.end).toBe("completed");
    expect(store.checkpoints.get("cp-2")?.end).toBe("completed");
  });

  it("a request that needs nothing completes at once and leaves the open one be", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "baseline", 1, [a]);
    checkpoints.completeAtOnce("cp-2", "run-all", 1);
    expect(store.checkpoints.get("cp-2")?.end).toBe("completed");
    expect(checkpoints.active?.record.id).toBe("cp-1");
  });

  it("a stopping daemon owes an explicit checkpoint and abandons a baseline", () => {
    const first = tracker();
    first.checkpoints.start("cp-1", "baseline", 1, [a, b]);
    first.checkpoints.join("cp-2", "run-all", 1, [a, b]);
    first.checkpoints.done(a, "cp-1");
    first.checkpoints.owe();
    const { store } = first;
    expect(store.checkpoints.get("cp-1")?.end).toBe("abandoned");
    expect(store.checkpoints.get("cp-2")?.end).toBeNull();
    expect(progress(store)).toMatchObject({
      done: 1,
      total: 2,
      owed: { ids: ["cp-2"], remaining: [b], strict: [] },
    });

    // The next daemon's tracker takes it once, and resumes it as the open checkpoint.
    const next = new Checkpoints(store, "wt", () => 500);
    const taken = next.takeOwed();
    expect(taken?.records.map((r) => r.id)).toEqual(["cp-2"]);
    expect(next.takeOwed()).toBeNull();
    next.resume(taken?.records ?? [], [b], []);
    expect(next.idFor(b)).toBe("cp-2");
    next.done(b, "cp-2");
    expect(store.checkpoints.get("cp-2")?.end).toBe("completed");
  });

  it("a resumed forced file counts only from its own runs, and a baseline it joins ends with it", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "run-all", 1, [a], true);
    checkpoints.owe();
    const next = new Checkpoints(store, "wt", () => 500);
    const taken = next.takeOwed();
    next.start("base", "baseline", 2, [b]);
    next.resume(taken?.records ?? [], [a], [a]);
    next.done(a, null);
    next.done(b, "base");
    expect(store.checkpoints.get("base")?.end).toBeNull();
    next.done(a, "base");
    expect(store.checkpoints.get("base")?.end).toBe("completed");
    expect(store.checkpoints.get("cp-1")?.end).toBe("completed");
  });

  it("a checkpoint a killed daemon left open is abandoned by the next, never resumed", () => {
    const { store, checkpoints } = tracker();
    checkpoints.start("cp-1", "run-all", 1, [a]);
    const next = new Checkpoints(store, "wt", () => 500);
    expect(next.takeOwed()).toBeNull();
    expect(store.checkpoints.get("cp-1")?.end).toBe("abandoned");
  });
});
