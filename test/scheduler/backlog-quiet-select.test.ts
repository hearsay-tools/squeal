import { afterEach, describe, expect, it } from "vitest";
import {
  BACKLOG_QUIET_MS,
  BacklogQuiet,
  publishedQuiet,
  publishQuiet,
  quietMetaKey,
} from "../../src/core/scheduler/quiet.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { freshStore } from "../state/helpers.js";

/*
 * Row 011-94 (spec 011 C4 step 5 as amended 2026-10-21, `tasks/011-82/design.md`
 * row A, the lead): a lane's wait for quiet after its backlog tier's cancel,
 * and what it publishes. What the tier plan starts while a lane waits is
 * `tier-plan-quiet.test.ts`'s (row 011-349).
 */

const WT = "wt-011-94" as WorktreeId;
const T0 = 1_000_000;
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("a lane's wait for quiet (row 011-94)", () => {
  it("a revision that queues a file of the lane starts the wait again; another lane's does not", () => {
    const quiet = new BacklogQuiet();
    quiet.cancelled("vitest", T0);
    quiet.queued("node-test", T0 + 15_000);
    expect(quiet.waits("vitest", T0 + BACKLOG_QUIET_MS)).toBe(false);

    quiet.cancelled("vitest", T0);
    quiet.queued("vitest", T0 + 15_000);
    expect(quiet.waits("vitest", T0 + BACKLOG_QUIET_MS)).toBe(true);
    expect(quiet.waits("vitest", T0 + 15_000 + BACKLOG_QUIET_MS)).toBe(false);
    // No wait, nothing to start again: a queue outside a wait starts none.
    quiet.queued("vitest", T0 + 40_000);
    expect(quiet.waits("vitest", T0 + 40_001)).toBe(false);
  });

  it("publishes each wait's end for status, and a row older than the daemon is not its own", () => {
    const store = freshStore();
    stores.push(store);
    const quiet = new BacklogQuiet((ends, now) => publishQuiet(store, WT, ends, now));
    quiet.cancelled("", T0);
    expect(publishedQuiet(store, WT, T0, T0 + 1)).toEqual(new Map([["", T0 + BACKLOG_QUIET_MS]]));
    expect(publishedQuiet(store, WT, T0 + 1, T0 + 1).size).toBe(0);
    expect(publishedQuiet(store, WT, T0, T0 + BACKLOG_QUIET_MS).size).toBe(0);
    quiet.end(T0 + 5);
    expect(store.meta.get(quietMetaKey(WT))).toBeNull();
  });
});
