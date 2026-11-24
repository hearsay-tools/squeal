import { describe, expect, it } from "vitest";
import { heldPermits } from "../../src/core/slow/slot.js";
import { readGroupActivity } from "../../src/core/slow/state.js";
import { liveActivity } from "../../src/core/state/slow.js";
import { slotWaitText } from "../../src/core/state/slow-text.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { CatchUpSide } from "./catch-up-fixture.js";
import { A, holdFirst, PATHS, pair } from "./slot-pairs-fixture.js";

/*
 * Review 0.1.621 B2, the reviewer's probe on the two real schedulers of
 * `slot-pairs-fixture.ts`, with a 30 s recheck so that only the test moves
 * a lane: the waiting side published `slot: "held"`, and the status words
 * said `(in use)` after the holder had let the slot go.
 */

const slotOf = (side: CatchUpSide) =>
  readGroupActivity(side.store, side.worktreeId as WorktreeId, "browser");

describe("a slot wait's words from the slot as it is now (review 0.1.621 B2)", {
  timeout: 60_000,
}, () => {
  it("never says a free slot is in use", async () => {
    const { tree, commit, log, slotDir } = await pair(30_000);
    const release = holdFirst(commit, A);
    await commit.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await expect.poll(() => log.length, { timeout: 20_000 }).toBe(1);
    await tree.scheduler.requestGroupPaths?.("browser", PATHS, { at: true });
    await tree.rest();
    expect(slotOf(tree)).toMatchObject({ kind: "waiting", for: "slot", slot: "held" });

    const browser = (path: { path: string }) => path.path.startsWith("test/browser/");
    const words = () => {
      const keys = tree.store.testFileKeys.list(tree.worktreeId as WorktreeId);
      const now = liveActivity(tree.store, tree.worktreeId as WorktreeId, keys, browser, "browser");
      return now?.kind === "waiting" && now.slot !== undefined
        ? slotWaitText("the browser group's slot", now.slot)
        : null;
    };
    expect(words()).toBe("the browser group's slot (in use)");
    release();
    await expect.poll(() => slotOf(commit), { timeout: 20_000 }).toMatchObject({ slot: "turn" });
    // Before the working tree's recheck: its published wait still reads `held`.
    expect(slotOf(tree)).toMatchObject({ slot: "held" });
    const dir = slotDir as AbsolutePath;
    expect(heldPermits({ dir, permits: 1, group: "browser" })).toEqual([]);
    expect(words()).toBe("the browser group's slot (taken at its last try, free now)");
  });
});
