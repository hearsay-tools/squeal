import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishedNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";
import { heldSide } from "./held-side-fixture.js";

/*
 * Review 0.1.610 B1 (row 023-67): the scheduler publishes the files a
 * narrow run asked a held group's lane to run, each at its asked key, so
 * status can tell a released file from a held one. The row follows the
 * lane's asks: a re-key drops a file's ask, and the row goes once none is
 * left. A named wait publishes none.
 */

const FILES: readonly CatchUpFile[] = ["a", "b"].map((name) => ({
  path: `test/browser/${name}.test.ts`,
  ms: 10,
  imports: [`src/${name}.ts`],
}));
const [A, B] = FILES.map((file) => file.path) as [string, string];
const id = (path: string) => testFileId({ project: "", path });

function asks(side: CatchUpSide): ReadonlyMap<string, string> {
  return publishedNarrowAsks(side.store, side.worktreeId as WorktreeId, 0 as EpochMs);
}

const keyOf = (side: CatchUpSide, path: string) =>
  side.store.testFileKeys
    .list(side.worktreeId as WorktreeId)
    .find((row) => row.testFile.path === path)?.key;

describe("the narrow asks row (review 0.1.610 B1)", { timeout: 60_000 }, () => {
  it("holds a narrow run's asks at their keys, drops a re-keyed one, and goes with the last", async () => {
    const { side, gate } = await heldSide(FILES);
    await side.edit("watch", "src/a.ts", "src/b.ts");
    await side.rest();
    // A named wait releases nothing and publishes no ask.
    await side.scheduler.promote(
      FILES.map((file) => ({ project: "", path: file.path })),
      60_000,
    );
    await side.rest();
    expect(side.runner.runs).toHaveLength(0);
    expect(asks(side).size).toBe(0);
    await side.scheduler.requestGroupPaths?.("browser", [A, B]);
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const first = side.runner.runs[0]?.files[0]?.path === A ? A : B;
    const second = first === A ? B : A;
    expect(asks(side)).toEqual(
      new Map([
        [id(A), keyOf(side, A)],
        [id(B), keyOf(side, B)],
      ]),
    );
    // An edit re-keys the queued file: its ask leaves, the running one's stays.
    await side.edit("watch", second === A ? "src/a.ts" : "src/b.ts");
    await side.rest();
    await expect.poll(() => [...asks(side).keys()], { timeout: 20_000 }).toEqual([id(first)]);
    // The run ends; no ask is left, so the row is gone.
    gate.release();
    await expect
      .poll(() => side.store.meta.get(`narrow-asks:${side.worktreeId}`), {
        timeout: 20_000,
      })
      .toBeNull();
    gate.stop();
  });
});
