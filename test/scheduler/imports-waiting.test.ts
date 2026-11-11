import { describe, expect, it } from "vitest";
import {
  clearImportsWaiting,
  importsKeyed,
  importsWaiting,
  importsWaitingMetaKey,
  markImportsWaiting,
} from "../../src/core/scheduler/imports-waiting.js";
import { freshStore, OTHER, WT } from "../state/helpers.js";
import { claimRepo, side } from "./claims-fixture.js";

/*
 * Review of 0.1.428, B1: the imports a running daemon's keys have not taken
 * yet, a row of its worktree's that status reads. The retry request adds,
 * the refinement's apply removes what it took, and a start empties it.
 */

describe("the imports the keys wait for (review of 0.1.428, B1)", () => {
  it("adds each import once, removes what the keys took, and drops the row when none is left", () => {
    const store = freshStore();
    expect(importsWaiting(store, WT)).toEqual([]);
    markImportsWaiting(store, WT, ["imp-b", "imp-a"]);
    markImportsWaiting(store, WT, ["imp-a"]);
    markImportsWaiting(store, OTHER, ["imp-c"]);
    expect(importsWaiting(store, WT)).toEqual(["imp-a", "imp-b"]);
    importsKeyed(store, WT, ["imp-a"]);
    expect(importsWaiting(store, WT)).toEqual(["imp-b"]);
    importsKeyed(store, WT, ["imp-b"]);
    expect(store.meta.get(importsWaitingMetaKey(WT))).toBeNull();
    expect(importsWaiting(store, OTHER)).toEqual(["imp-c"]);
  });

  it("reads a row it can not parse as none", () => {
    const store = freshStore();
    store.meta.set(importsWaitingMetaKey(WT), "{");
    expect(importsWaiting(store, WT)).toEqual([]);
    store.meta.set(importsWaitingMetaKey(WT), '["imp-a", 3]');
    expect(importsWaiting(store, WT)).toEqual(["imp-a"]);
    clearImportsWaiting(store, WT);
    expect(store.meta.get(importsWaitingMetaKey(WT))).toBeNull();
  });

  it("is emptied by a start, whose keys read every import", async () => {
    const { main } = claimRepo(1);
    const s = side(main, { count: 1 });
    // An earlier daemon stopped before its refinement took the import.
    markImportsWaiting(s.store, s.worktreeId, ["imp-a"]);
    await s.scheduler.start();
    expect(importsWaiting(s.store, s.worktreeId)).toEqual([]);
  });
});
