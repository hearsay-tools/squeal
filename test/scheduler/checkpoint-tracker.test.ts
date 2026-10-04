import { describe, expect, it } from "vitest";
import { Checkpoints } from "../../src/core/scheduler/checkpoints.js";
import type { TestFileRef } from "../../src/core/types/index.js";
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
