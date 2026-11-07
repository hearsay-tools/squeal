import { describe, expect, it } from "vitest";
import type { CommitReport } from "../../src/core/commit/report.js";
import { commitReportsMetaKey, readCommitReports } from "../../src/core/commit/store.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { Policy } from "../../src/core/types/policy.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 019-22 (spec 019 D5 steps 1 and 3, Testing "Commit"): a test group at
 * `commit` runs once per new commit, the files whose closure the commit
 * changed, and never at an edit; a report with running checks updates
 * exactly once after they end, an edit between included; a move to a
 * commit already reported runs nothing new. A real repository and
 * scheduler; the fake runner fails a file while its path is in `failing`.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const C = "test/c.test.ts";
const FILES: CatchUpFile[] = [
  { path: A, ms: 10, imports: ["src/a.ts"] },
  { path: B, ms: 10, imports: ["src/b.ts"] },
  { path: C, ms: 10, imports: ["src/c.ts"] },
];
const AT_COMMIT: CheckGroup = { name: "ci", runner: "vitest", tests: [B, C], at: "commit" };

async function started(policy: Partial<Policy> = {}): Promise<{ root: string; side: CatchUpSide }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 4,
    policy: { ...RUN_MISSING, checks: [AT_COMMIT], ...policy },
  });
  await side.scheduler.start();
  await side.scheduler.idle();
  return { root: repo.main, side };
}

/** Hands the scheduler one watch batch of `paths`, as the change feed would, with no edit. */
async function watch(side: CatchUpSide, ...paths: string[]): Promise<void> {
  const hasher = createFsHasher(side.root, "sha1");
  await side.scheduler.handleBatch({
    trigger: "watch",
    paths: await statCandidates(paths, hasher),
  });
}

/** The idle reconciliation pass (spec 001 D2): not a watch batch, so it may report. */
async function pass(side: CatchUpSide): Promise<void> {
  await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
}

const head = (root: string) => git(root, ["rev-parse", "HEAD"]).trim();
const runsOf = (side: CatchUpSide, path: string) => side.runner.runsOf(path).length;
const newest = (side: CatchUpSide): CommitReport | undefined =>
  readCommitReports(side.store.meta, side.worktreeId)?.reports[0];

/** Each stored state of `commit`'s report, in the order the store took them. */
function writesOf(side: CatchUpSide, commit: string): CommitReport[] {
  const seen: CommitReport[] = [];
  const { meta } = side.store;
  const set = meta.set.bind(meta);
  meta.set = (key, value) => {
    set(key, value);
    if (key !== commitReportsMetaKey(side.worktreeId)) return;
    const report = readCommitReports(meta, side.worktreeId)?.reports.find(
      (r) => r.commit === commit,
    );
    if (report !== undefined && JSON.stringify(report) !== JSON.stringify(seen.at(-1))) {
      seen.push(report);
    }
  };
  return seen;
}

describe("commit groups run at commit (019-22)", { timeout: 60_000 }, () => {
  it("runs a test group at `commit` once per new commit, only for what the commit changed", async () => {
    const { root, side } = await started();
    expect(runsOf(side, A), "the `tests` group runs at the start").toBe(1);
    expect(runsOf(side, B) + runsOf(side, C), "never before a commit").toBe(0);

    await side.edit("watch", "src/b.ts", "src/c.ts");
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B) + runsOf(side, C), "an edit runs no `commit` group").toBe(0);

    git(root, ["add", "src/b.ts"]);
    git(root, ["commit", "-qm", "b only"]);
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B), "the commit changed b's closure").toBe(1);
    expect(runsOf(side, C), "c's change is left unstaged: no result for the commit").toBe(0);
    await pass(side);
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B), "once per commit").toBe(1);

    git(root, ["commit", "-qam", "c"]);
    await pass(side);
    await side.scheduler.idle();
    expect([runsOf(side, B), runsOf(side, C)]).toEqual([1, 1]);
    expect(side.current(B) && side.current(C)).toBe(true);
    expect(side.scheduler.slowPending()).toBe(false);
  });

  it("updates a report with running checks exactly once after they end, an edit between included", async () => {
    const { root, side } = await started();
    side.runner.failing.add(B);
    await side.edit("watch", "src/b.ts");
    await side.scheduler.idle();
    git(root, ["commit", "-qam", "b"]);
    const commit = head(root);
    const writes = writesOf(side, commit);
    side.runner.hold();
    await pass(side);
    // c waits for a commit that changes its closure: it runs for no one, so it is unknown.
    expect(newest(side)).toMatchObject({
      commit,
      tests: { files: 3, failures: 0, notDetermined: 0, running: 1, unknown: 1 },
    });
    expect(newest(side)).not.toHaveProperty("updated");

    // An edit between: a's closure now differs from the commit.
    await side.edit("watch", "src/a.ts");
    side.runner.release();
    await side.scheduler.idle();
    await pass(side);
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B)).toBe(1);
    expect(writes.map((r) => ("tests" in r ? r.tests : r))).toEqual([
      { files: 3, failures: 0, notDetermined: 0, running: 1, unknown: 1 },
      {
        files: 3,
        failures: 1,
        notDetermined: 1,
        running: 0,
        unknown: 1,
        notDeterminedFiles: [{ project: "", path: "test/a.test.ts", through: ["src/a.ts"] }],
      },
    ]);
    expect(writes[1]).toMatchObject({ commit, updated: true });
    expect(writes[1]).not.toHaveProperty("waiting");
  });

  it("an edit that re-keys an asked file before it runs leaves it to the next commit", async () => {
    const { root, side } = await started();
    await side.edit("watch", "src/b.ts");
    await side.scheduler.idle();
    git(root, ["commit", "-qam", "b"]);
    const commit = head(root);
    const writes = writesOf(side, commit);
    side.runner.hold();
    // The pass reports, then the edit's batch comes before the lane starts b.
    const reported = pass(side);
    await side.edit("watch", "src/b.ts");
    await reported;
    side.runner.release();
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    const ran = side.runner.runsOf(B);
    expect(
      ran.every((run) => run.cancelled) || ran.length === 0,
      "b has no result for the edit",
    ).toBe(true);
    expect(side.current(B)).toBe(false);
    expect(writes.at(-1)).toMatchObject({ updated: true, tests: { running: 0 } });
    expect(writes).toHaveLength(2);

    git(root, ["commit", "-qam", "b again"]);
    await pass(side);
    await side.scheduler.idle();
    expect(side.current(B), "the next commit runs it").toBe(true);
  });

  it("a reset or checkout to a commit already reported runs nothing new", async () => {
    const { root, side } = await started();
    await side.edit("watch", "src/b.ts");
    await side.scheduler.idle();
    git(root, ["commit", "-qam", "b1"]);
    const first = head(root);
    await pass(side);
    await side.scheduler.idle();
    await side.edit("watch", "src/b.ts");
    await side.scheduler.idle();
    git(root, ["commit", "-qam", "b2"]);
    await pass(side);
    await side.scheduler.idle();
    expect(runsOf(side, B)).toBe(2);

    git(root, ["reset", "-q", "--hard", first]);
    await watch(side, "src/b.ts");
    await side.scheduler.idle();
    await pass(side);
    await side.scheduler.idle();
    expect(newest(side)?.commit).toBe(first);
    expect(runsOf(side, B), "a known commit runs nothing").toBe(2);
  });
});
