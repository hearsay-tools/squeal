import { describe, expect, it } from "vitest";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Spec 023 D4.5, D7.3 as amended (row 023-40c; the seam agreed with row
 * 023-46): a commit daemon selects the files a change reaches from its key
 * index alone. `Scheduler.changedSelects` names each file whose closure
 * holds a changed path, and a changed test file itself, and never calls
 * the runner: the runner's `affected` would walk every source again.
 */

const FILES: readonly CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/b.test.ts", ms: 10, imports: ["src/other.ts"] },
  { path: "test/c.test.ts", ms: 10, imports: ["src/core.ts"] },
];

describe("Scheduler.changedSelects (row 023-40c)", () => {
  it("selects from the key index, a changed test file by its own path, and asks the runner nothing", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 2 });
    const changedSelects = side.scheduler.changedSelects?.bind(side.scheduler);
    expect(changedSelects).toBeDefined();
    if (changedSelects === undefined) return;
    // Before the start: no index, no selection.
    expect(await changedSelects(["src/core.ts"])).toEqual([]);
    await side.scheduler.start();
    await side.rest();
    let asked = 0;
    side.runner.affected = async () => {
      asked += 1;
      throw new Error("the commit-side selection must not ask the runner");
    };

    const paths = async (changed: string[]) =>
      (await changedSelects(changed)).map((ref) => ref.path).sort();
    expect(await paths(["src/core.ts"])).toEqual(["test/a.test.ts", "test/c.test.ts"]);
    expect(await paths(["test/b.test.ts"])).toEqual(["test/b.test.ts"]);
    expect(await paths(["src/other.ts", "src/none.ts"])).toEqual(["test/b.test.ts"]);
    expect(await paths([])).toEqual([]);
    expect(asked).toBe(0);
  });
});
