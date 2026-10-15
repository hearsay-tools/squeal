import { beforeEach, describe, expect, it } from "vitest";
import { headerLines } from "../../src/core/delivery/index.js";
import { readHeader } from "../../src/core/state/index.js";
import type { CheckpointLane, Store } from "../../src/core/types/index.js";
import { worktreeMetaKey } from "../../src/core/types/index.js";
import { fullSuiteReason } from "../../src/harness/shared/text.js";
import { freshStore, WT } from "../state/helpers.js";

/*
 * Review 001-417 B1: a one-lane checkpoint is never a full-suite checkpoint
 * (task 004-61), however many one-lane checkpoints come after it. The lane
 * map kept 32 labels, so the 33rd fast-only run turned the first into a full
 * one for the header and `stop.requireFullSuite`.
 */

let store: Store;

beforeEach(() => {
  store = freshStore();
  store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: "h0", newHash: "h1" }],
  });
});

function checkpoint(
  id: string,
  at: number,
  lane: CheckpointLane | undefined,
  end: "completed" | "abandoned" = "completed",
): void {
  store.checkpoints.start({
    id,
    kind: "run-all",
    worktreeId: WT,
    revision: 1,
    testFiles: [],
    startedAt: at,
    ...(lane === undefined ? {} : { lane }),
  });
  store.checkpoints.finish(id, end, at);
}

function storedLanes(): Record<string, string> {
  return JSON.parse(store.meta.get(worktreeMetaKey("checkpointLanes", WT)) ?? "{}");
}

function expectNoFullSuite(): void {
  expect(store.checkpoints.lastCompletedFull(WT)).toBeNull();
  const header = readHeader(store, WT);
  expect(header.fullSuite.atCurrentRevision).toBe(false);
  expect(headerLines(header, "squeal").join("\n")).toContain(
    "Full-suite checkpoint: none completed at any revision; only the fast lane completed, at revision 1",
  );
  expect(fullSuiteReason(header)).toContain("none completed at any revision");
}

describe("a one-lane checkpoint keeps its lane (review 001-417 B1)", () => {
  it("40 fast-only checkpoints and no full one: none reads as full", () => {
    for (let i = 1; i <= 40; i++) checkpoint(`fast-${i}`, i, "fast");
    expect(store.checkpoints.get("fast-1")?.lane).toBe("fast");
    expect(Object.keys(storedLanes())).toHaveLength(40);
    expectNoFullSuite();
  });

  it("an older real full run stays the last full one behind 40 fast-only runs", () => {
    checkpoint("full", 1, undefined);
    for (let i = 2; i <= 41; i++) checkpoint(`fast-${i}`, i, "fast");
    expect(store.checkpoints.lastCompletedFull(WT)?.id).toBe("full");
    expect(store.checkpoints.get("fast-2")?.lane).toBe("fast");
    const header = readHeader(store, WT);
    expect(header.fullSuite.atCurrentRevision).toBe(true);
    expect(header.fullSuite.lastCompletedRevision).toBe(1);
  });

  it("abandoned one-lane requests never push a completed one's lane out", () => {
    checkpoint("fast-done", 1, "fast");
    for (let i = 2; i <= 40; i++) checkpoint(`slow-${i}`, i, "slow", "abandoned");
    expect(storedLanes()["fast-done"]).toBe("fast");
    expect(store.checkpoints.get("fast-done")?.lane).toBe("fast");
    expectNoFullSuite();
  });

  it("a lane goes with its checkpoint once prune removes it", () => {
    checkpoint("fast-1", 1, "fast");
    store.meta.set(
      worktreeMetaKey("checkpointLanes", WT),
      JSON.stringify({ gone: "fast", "fast-1": "fast" }),
    );
    checkpoint("fast-2", 2, "fast");
    expect(storedLanes()).toEqual({ "fast-1": "fast", "fast-2": "fast" });
  });
});
