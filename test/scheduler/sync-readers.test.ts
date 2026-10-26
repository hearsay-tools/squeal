import { describe, expect, it } from "vitest";
import { type CatchUpFile, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-234 (005 D2 as amended): a named wait's sync names each source
 * path's readers from this worktree's key index, read with the revision it
 * reports, so an edit whose runner part has not stored the closures yet, or
 * another worktree's write, changes nothing it names.
 */

const START = "src/start.ts";
const FILES: CatchUpFile[] = [
  { path: "test/direct.test.ts", ms: 1, imports: [START] },
  { path: "test/helper.test.ts", ms: 1, imports: ["test/helpers.ts"], through: [START] },
  { path: "test/other.test.ts", ms: 1, imports: ["src/other.ts"] },
];
const READERS = [
  { project: "", path: "test/direct.test.ts" },
  { project: "", path: "test/helper.test.ts" },
];

describe("Scheduler.readers", () => {
  it("names a path's readers in the key index with the revision, none for a path no closure holds", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 2,
      policy: { baseline: { onStart: "lookup-only" } },
    });
    // Before the start: the revision only.
    expect(await side.scheduler.readers?.([START])).toEqual({ revision: 0 });
    await side.scheduler.start();
    await side.scheduler.idle();

    const before = await side.scheduler.readers?.([START, "src/none.ts"]);
    expect(before).toEqual({
      revision: side.scheduler.status().revision,
      readers: { [START]: READERS, "src/none.ts": [] },
    });

    // The edit's revision: the same readers, at the revision that holds it.
    await side.edit("watch", START);
    const after = await side.scheduler.readers?.([START]);
    expect(after?.revision).toBe(side.scheduler.status().revision);
    expect(after?.revision).toBeGreaterThan(before?.revision ?? 0);
    expect(after?.readers).toEqual({ [START]: READERS });
  });
});
