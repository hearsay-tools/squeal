import { describe, expect, it } from "vitest";
import { queueFullSuite } from "../../src/core/scheduler/checkpoint-requests.js";
import { Checkpoints } from "../../src/core/scheduler/checkpoints.js";
import { type FileState, newFileState } from "../../src/core/scheduler/files.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Review 001-417 S1: a `run --all --fast` request that joins a running full
 * baseline ends when its own fast files have a result, never held, or
 * abandoned, by the baseline's slow files (task 004-61).
 */

const fast: TestFileRef = { project: "", path: "test/fast.test.ts" };
const slow: TestFileRef = { project: "", path: "test/slow.test.ts" };

function setup() {
  const store = open(fakeCommonDir());
  let now = 100;
  const checkpoints = new Checkpoints(store, "wt", () => now++);
  const files = new Map<string, FileState>(
    [fast, slow].map((ref) => {
      const file = newFileState(ref);
      file.key = `key-${ref.path}`;
      file.phase = "queued";
      return [file.id, file];
    }),
  );
  const ledger = {
    revision: { number: 1, head: null, dirty: true },
    checkpoints,
    files,
    confirmHeld: () => {},
    settle: () => [],
    enqueue: () => {},
    commit: () => {},
  } as unknown as Ledger;
  checkpoints.start("baseline", "baseline", 1, [fast, slow]);
  const isSlow = (ref: TestFileRef) => ref.path === slow.path;
  const requested = queueFullSuite(ledger, false, false, { lane: "fast", isSlow });
  return { store, checkpoints, requested };
}

describe("a one-lane request joined to a full baseline (review 001-417 S1)", () => {
  it("joins, and completes once its fast file has a result while the slow one runs on", () => {
    const { store, checkpoints, requested } = setup();
    expect(requested.owner).toBe("baseline");
    expect(requested.testFiles).toEqual([fast]);
    checkpoints.done(fast, "baseline");
    expect(store.checkpoints.get(requested.id)).toMatchObject({ lane: "fast", end: "completed" });
    expect(store.checkpoints.get("baseline")?.end).toBeNull();
    expect(checkpoints.active?.explicit).toBe(false);
  });

  it("a slow file that times out after the fast one finished leaves it completed", () => {
    const { store, checkpoints, requested } = setup();
    checkpoints.done(fast, "baseline");
    checkpoints.failed(slow);
    expect(store.checkpoints.get(requested.id)?.end).toBe("completed");
    expect(store.checkpoints.get("baseline")?.end).toBe("abandoned");
  });

  it("its own fast file crashing abandons it, before the slow one ends", () => {
    const { store, checkpoints, requested } = setup();
    checkpoints.failed(fast);
    expect(store.checkpoints.get(requested.id)?.end).toBe("abandoned");
    expect(store.checkpoints.get("baseline")?.end).toBeNull();
  });

  it("a newer request replacing the baseline abandons it while its file is open", () => {
    const { store, checkpoints, requested } = setup();
    checkpoints.start("next", "run-all", 2, [fast]);
    expect(store.checkpoints.get(requested.id)?.end).toBe("abandoned");
  });

  it("a full request joined to the baseline still ends with it", () => {
    const { store, checkpoints } = setup();
    checkpoints.join("full", "run-all", 1, [slow]);
    checkpoints.failed(slow);
    expect(store.checkpoints.get("full")?.end).toBeNull();
    checkpoints.done(fast, "baseline");
    expect(store.checkpoints.get("full")?.end).toBe("abandoned");
  });
});
