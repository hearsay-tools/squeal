import { describe, expect, it } from "vitest";
import { promotionsMetaKey } from "../../src/core/scheduler/promotions.js";
import type { Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type CatchUpSide, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { heldRun, holdRuns, holds, ref } from "./tier-yields-fixture.js";

/*
 * Row 011-283, review `reviews/0.1.384.md` B1 (wave 62.5 RP1; W1 rule 3:
 * "A group lasts until each file has a current result at its key, its key
 * moved, or it left the queue"): a wait ends once each file it selected
 * has its answer, whether it was queued during the wait or was current
 * already, or became current through a shared result. A later edit of
 * such a file is plain edit work, after a newer wait's group. Before the
 * repair, a selected file that was never queued kept the finished wait
 * alive to its deadline, and the edit put its file back into that group.
 */

const names = ["a", "b", "c", "x"] as const;
const FILES = names.map((n) => ({ path: `test/${n}.test.ts`, ms: 10, imports: [`src/${n}.ts`] }));
const [A, B, C, X] = FILES.map((f) => f.path) as [string, string, string, string];
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };

const promotionsRow = (side: CatchUpSide) =>
  side.store.meta.get(promotionsMetaKey(side.worktreeId));

/**
 * X's short run holds the lane while `edited` and C are edited and a new
 * wait selects C; then the scheduler drains. The runs after X's, by path.
 */
async function laterEditAndWait(side: CatchUpSide, edited: string): Promise<string[][]> {
  const gate = holdRuns(side.runner, (path) => path === X);
  const base = side.runner.runs.length;
  await side.edit("watch", "src/x.ts");
  await heldRun(side, X, base);
  const after = side.runner.runs.length;
  await side.edit("watch", `src/${edited}.ts`, "src/c.ts");
  await side.scheduler.promote([ref(C)], 600_000);
  gate.stop();
  await side.scheduler.idle();
  return side.runner.runs.slice(after).map((run) => run.files.map((f) => f.path));
}

/** Every file current, then B's edit held in flight while a wait selects `first`, then B settles. */
async function finishedWait(first: readonly string[]) {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
  await side.scheduler.start();
  await side.scheduler.idle();
  expect(FILES.every((f) => side.current(f.path))).toBe(true);
  const gate = holdRuns(side.runner, (path) => path === B);
  const base = side.runner.runs.length;
  await side.edit("watch", "src/b.ts");
  await heldRun(side, B, base);
  await side.scheduler.promote(
    first.map((path) => ref(path)),
    600_000,
  );
  gate.stop();
  await side.scheduler.idle();
  expect([A, B].every((path) => side.current(path))).toBe(true);
  return side;
}

describe("a wait ends once each selected file has its answer (review 0.1.384 B1)", {
  timeout: 120_000,
}, () => {
  it("control: a wait on B alone ends when B settles; a later edit of B runs after a newer wait on C", async () => {
    const side = await finishedWait([B]);
    expect(promotionsRow(side)).toBeNull();
    expect(await laterEditAndWait(side, "b")).toEqual([[C], [B]]);
  });

  it("a wait on current A and queued B ends when B settles; a later edit of B runs after a newer wait on C", async () => {
    const side = await finishedWait([A, B]);
    expect(promotionsRow(side)).toBeNull();
    expect(await laterEditAndWait(side, "b")).toEqual([[C], [B]]);
  });

  it("a selected file nothing queued that becomes current through a shared result ends the wait", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: LOOKUP_ONLY });
    await side.scheduler.start();
    await side.scheduler.idle();
    // Lookup-only: B has a key, no result and nothing queued; the wait comes before anything runs it.
    expect(side.runner.runs).toEqual([]);
    await side.scheduler.promote([ref(B)], 600_000);
    // Another worktree runs B at the same key; this one takes the result with no run of its own.
    const other = catchUpSide(repo, repo.other, {
      files: FILES,
      hostSlots: 4,
      policy: RUN_MISSING,
    });
    await other.scheduler.start();
    await other.scheduler.idle();
    expect(other.current(B)).toBe(true);
    await side.scheduler.requestFullSuite();
    await side.scheduler.idle();
    expect(side.current(B)).toBe(true);
    expect(side.runner.runs.some((run) => holds(run, B))).toBe(false);

    expect(await laterEditAndWait(side, "b")).toEqual([[C], [B]]);
  });
});
