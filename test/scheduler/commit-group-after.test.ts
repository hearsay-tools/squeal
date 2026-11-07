import { describe, expect, it } from "vitest";
import type { CommitReport } from "../../src/core/commit/report.js";
import { commitReportsMetaKey, readCommitReports } from "../../src/core/commit/store.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 019-26 (review 0.1.398 B2; spec 019 D1 `after`, D5 steps 1 and 3): at
 * the commit moment, a `commit` group that follows another waits only for
 * the files the same commit asked the predecessor to run, and for its run
 * in flight. A predecessor file no commit asked for runs for no one, so it
 * holds nothing. A real repository and scheduler; the fake runner records
 * each run.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const C = "test/c.test.ts";
const FILES: CatchUpFile[] = [
  { path: A, ms: 10, imports: ["src/a.ts"] },
  { path: B, ms: 10, imports: ["src/b.ts"] },
  { path: C, ms: 10, imports: ["src/c.ts"] },
];

function groups(first: string[]): CheckGroup[] {
  return [
    { name: "first", runner: "vitest", tests: first, at: "commit" },
    { name: "second", runner: "vitest", tests: [B], at: "commit", after: ["first"] },
  ];
}

async function started(first: string[]): Promise<{ root: string; side: CatchUpSide }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 4,
    policy: { ...RUN_MISSING, checks: groups(first) },
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  return { root: repo.main, side };
}

/** The idle reconciliation pass (spec 001 D2): it reports a new commit. */
async function pass(side: CatchUpSide): Promise<void> {
  await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
}

/** Edits `paths` and commits them: the commit's SHA. The scheduler has not seen the commit yet. */
async function commit(root: string, side: CatchUpSide, ...paths: string[]): Promise<string> {
  await side.edit("watch", ...paths);
  await side.scheduler.idle();
  git(root, ["add", ...paths]);
  git(root, ["commit", "-qm", paths.join(" ")]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

/** Each stored state of `sha`'s report, in the order the store took them. */
function writesOf(side: CatchUpSide, sha: string): CommitReport[] {
  const seen: CommitReport[] = [];
  const { meta } = side.store;
  const set = meta.set.bind(meta);
  meta.set = (key, value) => {
    set(key, value);
    if (key !== commitReportsMetaKey(side.worktreeId)) return;
    const report = readCommitReports(meta, side.worktreeId)?.reports.find((r) => r.commit === sha);
    if (report !== undefined && JSON.stringify(report) !== JSON.stringify(seen.at(-1))) {
      seen.push(report);
    }
  };
  return seen;
}

/** Of `paths`, the files the runner started, in start order, each run after the previous one ended. */
function order(side: CatchUpSide, ...paths: string[]): string[] {
  const runs = side.runner.runs.filter((run) => run.files.some((f) => paths.includes(f.path)));
  runs.forEach((run, i) => {
    const before = runs[i - 1];
    if (before !== undefined) expect(run.startedAt).toBeGreaterThanOrEqual(before.endedAt ?? 1e15);
  });
  return runs.flatMap((run) => run.files.map((f) => f.path));
}

const runsOf = (side: CatchUpSide, path: string) => side.runner.runsOf(path).length;

describe("a commit group runs after its predecessor's asked files only (019-26, B2)", {
  timeout: 60_000,
}, () => {
  it("runs the follower when the commit changed only the follower's files", async () => {
    const { root, side } = await started([A]);
    expect(runsOf(side, A) + runsOf(side, B), "no commit yet").toBe(0);
    const sha = await commit(root, side, "src/b.ts");
    const writes = writesOf(side, sha);
    await pass(side);
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B), "the commit asked b").toBe(1);
    expect(runsOf(side, A), "a was not asked: it runs for no one").toBe(0);
    expect(writes.map((r) => ("tests" in r ? r.tests.running : r))).toEqual([1, 0]);
    expect(writes[1]).toMatchObject({ commit: sha, updated: true });
  });

  it("runs the follower once the predecessor's asked file ended, an unasked sibling queued", async () => {
    const { root, side } = await started([A, C]);
    const sha = await commit(root, side, "src/a.ts", "src/b.ts");
    const writes = writesOf(side, sha);
    await pass(side);
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    expect(order(side, A, B, C), "a first, then b; c was not asked").toEqual([A, B]);
    expect(writes.map((r) => ("tests" in r ? r.tests.running : r))).toEqual([2, 0]);
    expect(writes[1]).toMatchObject({ commit: sha, updated: true });
  });

  it("a request for the predecessor holds the follower for its unasked files too", async () => {
    const { root, side } = await started([A, C]);
    await commit(root, side, "src/a.ts", "src/b.ts");
    side.runner.hold();
    await pass(side);
    expect(await side.scheduler.requestGroup("first")).toMatchObject({ queued: 2 });
    side.runner.release();
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    const ran = order(side, A, B, C);
    expect(ran.indexOf(B), "b after a and c").toBe(2);
    expect(ran).toHaveLength(3);
  });

  it("keeps the order when the commit asked both groups", async () => {
    const { root, side } = await started([A]);
    const sha = await commit(root, side, "src/a.ts", "src/b.ts");
    const writes = writesOf(side, sha);
    await pass(side);
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    expect(order(side, A, B)).toEqual([A, B]);
    expect(writes.at(-1)).toMatchObject({ commit: sha, updated: true, tests: { running: 0 } });
    expect(writes).toHaveLength(2);
  });
});
