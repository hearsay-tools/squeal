import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CommitReport,
  type CommitTestCounts,
  commitReportText,
  readCommitReports,
} from "../../src/core/commit/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 019-13 (spec 019 D5 steps 2 to 4, Testing "Commit"): a plain commit, a
 * partial commit, an amend, a rebase and a commit under `core.hooksPath`
 * each give one stored report with the right counts, made at the first pass
 * that is not a watch batch; the report runs nothing, and Squeal installs no
 * git hook. A real repository and scheduler; the fake runner fails a file
 * while its path is in `failing`.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const FILES: CatchUpFile[] = [
  { path: A, ms: 10, imports: ["src/a.ts"] },
  { path: B, ms: 10, imports: ["src/b.ts"] },
];

async function started(): Promise<{ root: string; other: string; side: CatchUpSide }> {
  const repo = catchUpRepo(FILES);
  const side = catchUpSide(repo, repo.main, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
  await side.scheduler.start();
  await side.scheduler.idle();
  return { root: repo.main, other: repo.other, side };
}

/** Edits `paths` as a watch batch and waits for their runs. */
async function edit(side: CatchUpSide, ...paths: string[]): Promise<void> {
  await side.edit("watch", ...paths);
  await side.scheduler.idle();
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

const head = (root: string, rev = "HEAD") => git(root, ["rev-parse", rev]).trim();
const reports = (side: CatchUpSide): readonly CommitReport[] =>
  readCommitReports(side.store.meta, side.worktreeId)?.reports ?? [];
const counts = (report: CommitReport | undefined): CommitTestCounts | undefined =>
  report !== undefined && "tests" in report ? report.tests : undefined;
const clean = (failures = 0): CommitTestCounts => ({
  files: 2,
  failures,
  notDetermined: 0,
  running: 0,
  unknown: 0,
});

/** A pass reports `commit` once and runs nothing. */
async function reportedOnce(side: CatchUpSide, commit: string): Promise<CommitReport> {
  const runs = side.runner.runs.length;
  await pass(side);
  await pass(side);
  expect(side.runner.runs.length, "a report runs nothing").toBe(runs);
  const found = reports(side).filter((r) => r.commit === commit);
  expect(found).toHaveLength(1);
  return found[0] as CommitReport;
}

describe("commit reports from the HEAD move (019-13)", { timeout: 60_000 }, () => {
  it("a plain commit: one report from the committed keys, its failure counted", async () => {
    const { root, side } = await started();
    side.runner.failing.add(A);
    await edit(side, "src/a.ts");
    await pass(side);
    expect(reports(side), "no commit, no report").toEqual([]);

    git(root, ["commit", "-qam", "plain"]);
    const report = await reportedOnce(side, head(root));
    expect(counts(report)).toEqual(clean(1));
    expect(commitReportText(report)).toBe(`Commit ${head(root).slice(0, 7)}: 1 known failure`);
  });

  it("a partial commit: the file whose closure is left unstaged is not determined", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts", "src/b.ts");
    git(root, ["add", "src/a.ts"]);
    git(root, ["commit", "-qm", "partial"]);
    const report = await reportedOnce(side, head(root));
    expect(counts(report)).toEqual({ ...clean(), notDetermined: 1 });
    expect(commitReportText(report)).toContain("1 test file not determined (unstaged changes)");
  });

  it("an untracked file in a closure, or an environment input left unstaged, is not determined", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "first"]);
    await pass(side);
    git(root, ["rm", "-q", "--cached", "src/b.ts"]);
    git(root, ["commit", "-qm", "b untracked"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual({ ...clean(), notDetermined: 1 });

    await edit(side, "config.json");
    git(root, ["commit", "-qm", "env unstaged", "--allow-empty"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual({ ...clean(), notDetermined: 2 });
  });

  it("an amend: a second report for the new SHA, the first kept", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "first"]);
    const first = head(root);
    await reportedOnce(side, first);

    git(root, ["commit", "-q", "--amend", "-m", "amended"]);
    expect(head(root)).not.toBe(first);
    expect(counts(await reportedOnce(side, head(root)))).toEqual(clean());
    expect(reports(side).map((r) => r.commit)).toEqual([head(root), first]);

    // Back at the first commit (same tree): its report, as made, is the newest again.
    const [amended, kept] = reports(side);
    git(root, ["checkout", "-q", "--detach", first]);
    await pass(side);
    expect(reports(side)).toEqual([kept, amended]);
  });

  it("a rebase: one report for the new HEAD, none for the commits it passed", async () => {
    const { root, other, side } = await started();
    appendFileSync(join(other, "src/b.ts"), "// upstream\n");
    git(other, ["commit", "-qam", "upstream"]);
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "a1"]);
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "a2"]);
    await pass(side);
    const a2 = head(root);
    expect(reports(side).map((r) => r.commit)).toEqual([a2]);

    git(root, ["rebase", "-q", "other0"]);
    side.runner.hold();
    // The watcher's batch of the rebase's file makes a revision at the new HEAD; it reports nothing.
    await watch(side, "src/b.ts");
    expect(reports(side).map((r) => r.commit)).toEqual([a2]);
    const runs = side.runner.runs.length;
    await pass(side);
    expect(reports(side).map((r) => r.commit)).toEqual([head(root), a2]);
    expect(reports(side).map((r) => r.commit)).not.toContain(head(root, "HEAD~1"));
    // B's closure changed with the rebase; its run is held, so it is still running.
    expect(counts(reports(side)[0])).toEqual({ ...clean(), running: 1 });
    expect(side.runner.runs.length).toBe(runs);
    side.runner.release();
    await side.scheduler.idle();
  });

  it("a commit under core.hooksPath, or with --no-verify, is reported; Squeal installs no hook", async () => {
    const { root, side } = await started();
    const hooks = join(root, ".husky");
    mkdirSync(hooks);
    git(root, ["config", "core.hooksPath", ".husky"]);
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "husky"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual(clean());

    await edit(side, "src/b.ts");
    git(root, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-verify", "-am", "bypass"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual(clean());
    expect(readdirSync(hooks)).toEqual([]);
    const own = readdirSync(join(root, ".git", "hooks")).filter((f) => !f.endsWith(".sample"));
    expect(own).toEqual([]);
  });
});
