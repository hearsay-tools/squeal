import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CommitReport,
  type CommitTestCounts,
  commitReportText,
  readCommitReports,
} from "../../src/core/commit/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { lintScope, writeCursor, writeInputs } from "../../src/core/lint/pass/records.js";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/index.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { finding } from "../lint/helpers.js";
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

async function started(
  policy: Partial<Policy> = {},
  files: CatchUpFile[] = FILES,
): Promise<{ root: string; other: string; side: CatchUpSide }> {
  const repo = catchUpRepo(files);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    policy: { ...RUN_MISSING, ...policy },
  });
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

const CONFIG = "eslint.config.js";

/** What the lint pass records with its cursor: the config its keys were made of (019-21). */
function recordConfig(store: LintStore, worktreeId: string, blob: string, environment: string) {
  const scope = lintScope(worktreeId, "eslint");
  writeCursor(store.meta, scope, { revision: 1, environment });
  writeInputs(store.meta, scope, { environment, files: [[CONFIG, blob]], installed: false });
}

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
    expect("lint" in report, "no lint part while lint is off").toBe(false);
    expect(commitReportText(report)).toBe(`Commit ${head(root).slice(0, 7)}: 1 known failure`);
  });

  it("with lint on, a lint failure judged at the committed blob and config counts its findings", async () => {
    const lint = { ...DEFAULT_POLICY.lint, enabled: true };
    const { root, side } = await started({ lint });
    writeFileSync(join(root, CONFIG), "export default [];\n");
    git(root, ["add", CONFIG]);
    git(root, ["commit", "-qm", "lint config"]);
    await edit(side, "src/a.ts", "src/b.ts");
    const blob = (path: string) => git(root, ["hash-object", path]).trim();
    const store = openLintStore(join(root, ".git"), { lint }, { busyTimeoutMs: 10_000 });
    if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    const judged = (path: string) => ({
      worktreeId: side.worktreeId,
      check: { kind: "lint" as const, path, tool: "eslint" as const },
      outcome: "fail" as const,
      judged: {
        key: `k-${path}`,
        outcome: "fail" as const,
        fingerprint: null,
        blob: blob(path),
        revision: 1,
      },
      stale: false,
      reason: null,
      changedAt: 1,
    });
    for (const s of [judged("src/a.ts"), judged("src/b.ts")]) {
      store.states.upsertMany([s]);
      const findings = [finding("r", "one"), finding("r", "two", 2)];
      store.results.put(
        {
          check: s.check,
          key: s.judged.key,
          outcome: "fail",
          findings,
          fingerprint: null,
          toolVersion: "1",
          lintedAt: 1,
        },
        1,
      );
    }
    recordConfig(store, side.worktreeId, blob(CONFIG), "e1");
    git(root, ["add", "src/a.ts"]);
    git(root, ["commit", "-qm", "a only"]);
    // b, which the commit did not change, is not counted (019-28, P4).
    const report = await reportedOnce(side, head(root));
    expect(report).toMatchObject({ lint: { findings: 2, notDetermined: 0, running: 0 } });
    expect(commitReportText(report)).toBe(
      `Commit ${head(root).slice(0, 7)}: 0 known failures; lint 2 findings; 1 test file not determined (unstaged changes)`,
    );

    // Review 0.1.396 B2: a rule change left unstaged, linted (the record names its config).
    appendFileSync(join(root, CONFIG), "// rule off\n");
    recordConfig(store, side.worktreeId, blob(CONFIG), "e2");
    store.close();
    git(root, ["add", "src/b.ts"]);
    git(root, ["commit", "-qm", "b, config unstaged"]);
    const unstaged = await reportedOnce(side, head(root));
    expect(unstaged).toMatchObject({ lint: { findings: 0, notDetermined: 1, running: 0 } });
    expect(commitReportText(unstaged)).toBe(
      `Commit ${head(root).slice(0, 7)}: 0 known failures; lint 0 findings, 1 file not determined`,
    );
  });

  it("a partial commit: the file whose closure is left unstaged is not determined", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts", "src/b.ts");
    git(root, ["add", "src/a.ts"]);
    git(root, ["commit", "-qm", "partial"]);
    const report = await reportedOnce(side, head(root));
    // Row 019-37 (P11): the file is named with the path that makes it so.
    expect(counts(report)).toEqual({
      ...clean(),
      notDetermined: 1,
      notDeterminedFiles: [{ project: "", path: B, through: ["src/b.ts"] }],
    });
    expect(commitReportText(report)).toContain("1 test file not determined (unstaged changes)");
  });

  it("an untracked file in a closure, or an environment input left unstaged, is not determined", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "first"]);
    await pass(side);
    git(root, ["rm", "-q", "--cached", "src/b.ts"]);
    git(root, ["commit", "-qm", "b untracked"]);
    const untracked = await reportedOnce(side, head(root));
    expect(counts(untracked)).toEqual({
      ...clean(),
      notDetermined: 1,
      untracked: 1,
      notDeterminedFiles: [{ project: "", path: B, through: ["src/b.ts"] }],
    });
    expect(commitReportText(untracked)).toBe(
      `Commit ${head(root).slice(0, 7)}: 0 known failures; 1 test file not determined (untracked files)`,
    );

    await edit(side, "config.json");
    git(root, ["commit", "-qm", "env unstaged", "--allow-empty"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual({
      ...clean(),
      notDetermined: 2,
      notDeterminedFiles: [
        { project: "", path: A, through: ["config.json"] },
        { project: "", path: B, through: ["config.json", "src/b.ts"] },
      ],
    });
  });

  it("a test file the commit holds, deleted only in the working tree, is not determined (S3)", async () => {
    const { root, side } = await started();
    await edit(side, "src/a.ts");
    git(root, ["commit", "-qam", "first"]);
    expect(counts(await reportedOnce(side, head(root)))).toEqual(clean());

    // Deleted, not staged: a runner lists the files on disk, so the listing drops it.
    rmSync(join(root, B));
    side.runner.testFiles = async () => [{ project: "", path: A }];
    await watch(side, B);
    await side.scheduler.idle();
    expect(side.store.testFileKeys.list(side.worktreeId).map((r) => r.testFile.path)).toEqual([A]);
    git(root, ["commit", "-qm", "b deleted here only", "--allow-empty"]);
    const report = await reportedOnce(side, head(root));
    expect(counts(report)).toEqual({
      ...clean(),
      notDetermined: 1,
      notDeterminedFiles: [{ project: "", path: B, through: [], deleted: true }],
    });
    expect(commitReportText(report)).toContain("1 test file not determined (unstaged changes)");
  });

  it("a file git converts at checkout, on a clean tree, makes no test file not determined (019-37, P11)", async () => {
    // s1c: cezarion's gradlew.bat (`eol=crlf`) is CRLF on disk and LF in each commit.
    const bat = "app/gradlew.bat";
    const files = [FILES[0] as CatchUpFile, { path: B, ms: 10, imports: ["src/b.ts", bat] }];
    const { root, side } = await started({}, files);
    writeFileSync(join(root, ".gitattributes"), `${bat} text eol=crlf\n`);
    git(root, ["add", ".gitattributes"]);
    git(root, ["commit", "-qm", "attributes"]);
    rmSync(join(root, bat));
    git(root, ["checkout", "--", bat]);
    expect(git(root, ["status", "--porcelain"])).toBe("");
    await edit(side, "src/a.ts");
    await watch(side, bat, ".gitattributes");
    await side.scheduler.idle();
    git(root, ["commit", "-qam", "a"]);
    const report = await reportedOnce(side, head(root));
    expect(counts(report)).toEqual(clean());
    expect(commitReportText(report)).toBe(`Commit ${head(root).slice(0, 7)}: 0 known failures`);

    // An edit of the converted file left unstaged still makes its reader not determined.
    appendFileSync(join(root, bat), "rem\r\n");
    await watch(side, bat);
    await side.scheduler.idle();
    git(root, ["commit", "-qm", "bat unstaged", "--allow-empty"]);
    expect(counts(await reportedOnce(side, head(root)))).toMatchObject({
      notDetermined: 1,
      notDeterminedFiles: [{ project: "", path: B, through: [bat] }],
    });
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
    // B's closure changed with the rebase; its run is held for no commit: the report leaves it out (019-28).
    expect(counts(reports(side)[0])).toEqual(clean());
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
