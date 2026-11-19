import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { Gate, paths } from "./batch-fixture.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 011-397 (gh-181, `research/stuck-running.md` E1, E1b): `squeal run
 * tests <file>` on a file that is already queued promotes it as `status
 * --wait <file>` does (spec 011 C15 batch), so "which run now" is true. On
 * 0.1.563 the file kept its place: no run in 80 s while about 800 others
 * ran.
 */

const OTHERS = Array.from({ length: 800 }, (_, i) => `test/f${String(i).padStart(3, "0")}.test.ts`);
/** The longest file: shortest first puts it last of the queue. */
const TARGET = "test/target.test.ts";
const FILES: readonly CatchUpFile[] = [
  ...OTHERS.map((path) => ({ path, ms: 10, imports: ["src/shared.ts"] })),
  { path: TARGET, ms: 5_000, imports: ["src/shared.ts"] },
];

/** After a baseline, an edit of the shared source queues all 801; its first tier is held. */
async function queuedSide(): Promise<{ side: CatchUpSide; gate: Gate; after: number }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
  await side.scheduler.start();
  await side.quiet();
  const after = side.runner.runs.length;
  const gate = new Gate();
  side.runner.holdOf = () => gate.wait();
  await side.edit("watch", "src/shared.ts");
  await expect
    .poll(() => side.runner.runs.slice(after).some((run) => run.endedAt === null))
    .toBe(true);
  return { side, gate, after };
}

/** How many files the runs after the first `after` that started before `path`'s run held. */
function ranBefore(side: CatchUpSide, path: string, after: number): number {
  const runs = side.runner.runs.slice(after);
  const own = runs.findIndex((run) => paths(run).includes(path));
  if (own === -1) throw new Error(`${path} never ran`);
  return runs.slice(0, own).flatMap(paths).length;
}

describe("a narrow run on a queued file (row 011-397)", { timeout: 120_000 }, () => {
  it("runs the file before the queue's 800 others, as a named wait's batch", async () => {
    const { side, gate, after } = await queuedSide();
    expect(side.current(TARGET)).toBe(false);
    const request = side.scheduler.requestGroupPaths?.("tests", [TARGET]);
    gate.stop();
    await expect(request).resolves.toMatchObject({
      queued: 1,
      narrow: { current: 0, promoted: 1 },
    });
    await expect.poll(() => side.current(TARGET), { timeout: 60_000 }).toBe(true);
    // At most the held edit tier and the tier beside it ran first, never the queue's backlog.
    expect(ranBefore(side, TARGET, after)).toBeLessThan(20);
  });

  it("does not run a current file again", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.quiet();
    const after = side.runner.runs.length;
    const request = await side.scheduler.requestGroupPaths?.("tests", [TARGET]);
    expect(request).toMatchObject({ queued: 0, narrow: { current: 1, promoted: 0 } });
    await side.quiet();
    expect(side.runner.runs.slice(after).some((run) => paths(run).includes(TARGET))).toBe(false);
  });
});
