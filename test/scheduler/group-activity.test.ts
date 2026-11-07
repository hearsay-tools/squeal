import { describe, expect, it } from "vitest";
import {
  groupTiersMetaKey,
  publishGroupActivity,
  publishSlowActivity,
  readGroupActivity,
  readSlowActivity,
  slowTierMetaKey,
} from "../../src/core/slow/state.js";
import type { SlowTierActivity } from "../../src/core/types/status.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Wave 2's activity contract (coordinator, 2026-11-03; row 019-10): the
 * default `slow` group keeps its row `slow-tier:<worktree>`, written as
 * before; the configured groups of a worktree share one row,
 * `group-tier:<worktree>`, an object from group name to the
 * `SlowTierActivity` shape. `null` removes a group's entry, and an empty
 * row goes, so a worktree's removal drops it by its exact name.
 */

const RUNNING: SlowTierActivity = {
  kind: "running",
  path: "test/e2e/c.test.ts",
  since: 1,
  lastDurationMs: null,
};
const WAITING: SlowTierActivity = { kind: "waiting", for: "idle" };

describe("group lane activity rows (spec 019 D3, row 019-10)", () => {
  it("keeps the default slow group's row as `publishSlowActivity` writes it", () => {
    const store = open(fakeCommonDir());
    publishGroupActivity(store, "w1", "slow", RUNNING);
    expect(slowTierMetaKey("w1")).toBe("slow-tier:w1");
    expect(store.meta.get("slow-tier:w1")).toBe(JSON.stringify(RUNNING));
    expect(readGroupActivity(store, "w1", "slow")).toEqual(RUNNING);
    publishSlowActivity(store, "w1", null);
    expect(store.meta.get("slow-tier:w1")).toBe("null");
    expect(readSlowActivity(store, "w1")).toBeNull();
    expect(store.meta.get(groupTiersMetaKey("w1"))).toBeNull();
  });

  it("shares one row among the configured groups, an entry each, gone with the last", () => {
    const store = open(fakeCommonDir());
    expect(groupTiersMetaKey("w1")).toBe("group-tier:w1");
    publishGroupActivity(store, "w1", "e2e", RUNNING);
    publishGroupActivity(store, "w1", "api", WAITING);
    expect(JSON.parse(store.meta.get("group-tier:w1") ?? "")).toEqual({
      e2e: RUNNING,
      api: WAITING,
    });
    expect(readGroupActivity(store, "w1", "e2e")).toEqual(RUNNING);
    expect(readGroupActivity(store, "w1", "api")).toEqual(WAITING);
    expect(readGroupActivity(store, "w2", "e2e")).toBeNull();

    publishGroupActivity(store, "w1", "e2e", null);
    expect(JSON.parse(store.meta.get("group-tier:w1") ?? "")).toEqual({ api: WAITING });
    publishGroupActivity(store, "w1", "api", null);
    expect(store.meta.get("group-tier:w1")).toBeNull();
    expect(store.meta.get("slow-tier:w1")).toBeNull();
  });

  it("reads a row in a format it does not know as nothing published, and writes over it", () => {
    const store = open(fakeCommonDir());
    store.meta.set(groupTiersMetaKey("w1"), "[1]");
    expect(readGroupActivity(store, "w1", "e2e")).toBeNull();
    publishGroupActivity(store, "w1", "e2e", WAITING);
    expect(readGroupActivity(store, "w1", "e2e")).toEqual(WAITING);
  });
});
