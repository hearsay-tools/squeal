import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  type CommitReport,
  type CommitView,
  commitLine,
  commitReportText,
  committedBlobs,
  differingPaths,
  readCommitReports,
  testTally,
} from "../../src/core/commit/index.js";
import { storedBlobs } from "../../src/core/commit/stored.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { commitLines } from "../../src/core/status/commit-lines.js";
import { checkIgnored } from "../../src/core/watcher/git.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "../scheduler/catch-up-fixture.js";

/*
 * Row 019-39 (review 0.1.401-r2 N1): the commit report's one `git
 * hash-object --stdin-paths` (`storedBlobs`) runs under the scheduler lock.
 * A git that hangs on it holds a later watch batch for the call's bound,
 * about 2 s (`STORED_BLOBS_TIMEOUT_MS`), where it was 30 s; every
 * path it was asked for then stays a difference, so the report reads its
 * test file not determined. A git shim on `PATH`, put there after the
 * fixture is made, hands every command to git but `hash-object`, which it
 * records and sleeps through; `exec` leaves no child for the kill to miss.
 *
 * Review 0.1.402 B2: a git that does not answer in the bound says nothing
 * of the file, so the report reads it not determined "(git did not
 * answer)", never "(unstaged changes)"; a filter that answers within the
 * bound still makes the file the commit's.
 */

/**
 * The longest a stalled git may hold the caller: the brief's 2 s bound and
 * 3 s for the rest of the pass and the watch batch on a loaded host. A
 * number, not the constant, so a longer bound fails here.
 */
const HELD_AT_MOST_MS = 2_000 + 3_000;

/** Puts the shim first on `PATH` until the test ends; `calls` counts the `hash-object` calls. */
function stallHashObject(): { calls: () => number } {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-stall-git-")));
  const marks = join(dir, "calls");
  const shim = join(dir, "git");
  writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = hash-object ]; then\n  echo >> '${marks}'\n  exec sleep 45\nfi\nexec '${real}' "$@"\n`,
  );
  chmodSync(shim, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path ?? ""}`;
  onTestFinished(() => {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });
  return { calls: () => (existsSync(marks) ? readFileSync(marks, "utf8").length : 0) };
}

/** Sets each file's times a minute back, outside the racy window (`isRacy`). */
function age(root: string, ...paths: string[]): void {
  const then = new Date(Date.now() - 60_000);
  for (const path of paths) utimesSync(join(root, path), then, then);
}

describe("a git that hangs on `hash-object` (019-39, review 0.1.401-r2 N1)", {
  timeout: 60_000,
}, () => {
  it("leaves every path out after the bound", async () => {
    const { path: root, cleanup } = tempDir("squeal-stored-stall-");
    onTestFinished(cleanup);
    initRepo(root, { "src/a.ts": "a\n" });
    age(root, "src/a.ts");
    const blob = git(root, ["rev-parse", "HEAD:src/a.ts"]).trim();
    const hashes = new Map([["src/a.ts", blob]]);
    expect(await storedBlobs(root, hashes), "git answers").toEqual({
      blobs: hashes,
      unanswered: new Set(),
    });

    const stall = stallHashObject();
    const start = performance.now();
    expect(await storedBlobs(root, hashes)).toEqual({
      blobs: new Map(),
      unanswered: new Set(["src/a.ts"]),
    });
    expect(stall.calls()).toBe(1);
    expect(performance.now() - start).toBeLessThan(HELD_AT_MOST_MS);
  });

  it("holds a watch batch no longer than the bound, and the report reads the file not determined", async () => {
    const A = "test/a.test.ts";
    const files: CatchUpFile[] = [
      { path: A, ms: 10, imports: ["src/a.ts"] },
      { path: "test/b.test.ts", ms: 10, imports: ["src/b.ts"] },
    ];
    const repo = catchUpRepo(files);
    const root = repo.main;
    const side = catchUpSide(repo, root, { files, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();

    // `src/a.ts` is CRLF on disk and LF in each commit: only git's answer makes it the commit's.
    writeFileSync(join(root, ".gitattributes"), "src/a.ts text eol=crlf\n");
    git(root, ["add", ".gitattributes"]);
    git(root, ["commit", "-qm", "attributes"]);
    rmSync(join(root, "src/a.ts"));
    git(root, ["checkout", "--", "src/a.ts"]);
    age(root, "src/a.ts", ".gitattributes");
    expect(git(root, ["status", "--porcelain"])).toBe("");
    await watch(side, "src/a.ts", ".gitattributes");
    await side.scheduler.idle();
    await pass(side);
    const control = newest(side);
    expect(counts(control), "git answers: nothing differs").toMatchObject({ notDetermined: 0 });

    git(root, ["commit", "-q", "--allow-empty", "-m", "empty"]);
    const stall = stallHashObject();
    const reported = pass(side);
    await vi.waitFor(() => expect(stall.calls()).toBe(1), { timeout: 10_000, interval: 20 });
    const asked = performance.now();
    appendFileSync(join(root, "src/b.ts"), "// edit\n");
    await watch(side, "src/b.ts");
    expect(performance.now() - asked, "the watch batch waited").toBeLessThan(HELD_AT_MOST_MS);
    await reported;

    const report = newest(side);
    expect(report.commit).not.toBe(control.commit);
    expect(counts(report)).toMatchObject({ files: 2, notDetermined: 1, unanswered: 1 });
    expect(counts(report)?.notDeterminedFiles).toEqual([
      { project: "", path: A, through: ["src/a.ts"], unanswered: ["src/a.ts"] },
    ]);
    expect(full(report)).toEqual([
      `Commit ${report.commit.slice(0, 7)}: 0 known failures; 1 test file not determined (git did not answer)`,
      `  ${A} is not determined: git did not answer for src/a.ts`,
    ]);
  });

  it("a filter that answers in 2.3 s reads not determined (git did not answer); in 0.5 s it is the commit's", async () => {
    const { path: root, cleanup } = tempDir("squeal-stored-slow-");
    onTestFinished(cleanup);
    initRepo(root, {});
    git(root, ["config", "filter.slow.clean", "tr a-z A-Z"]);
    writeFileSync(join(root, ".gitattributes"), "src/a.ts filter=slow\n");
    writeFile(root, "src/a.ts", "hello\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "slow filter"]);
    age(root, "src/a.ts", ".gitattributes");
    expect(git(root, ["show", "HEAD:src/a.ts"])).toBe("HELLO\n");
    const raw = git(root, ["hash-object", "--no-filters", "src/a.ts"]).trim();
    const committed = await committedBlobs(root, "HEAD");
    expect(raw, "the key's bytes are not the committed blob").not.toBe(committed.get("src/a.ts"));
    const hashes = new Map([
      [".gitattributes", committed.get(".gitattributes") ?? ""],
      ["src/a.ts", raw],
    ]);
    const view = slowView(root, hashes);

    git(root, ["config", "filter.slow.clean", "sleep 0.5; tr a-z A-Z"]);
    const answered = await differingPaths(view, committed);
    expect([...answered.differing], "a slow filter in the bound clears").toEqual([]);

    git(root, ["config", "filter.slow.clean", "sleep 2.3; tr a-z A-Z"]);
    const start = performance.now();
    const late = await differingPaths(view, committed);
    expect(performance.now() - start).toBeLessThan(HELD_AT_MOST_MS);
    expect([...late.differing]).toEqual(["src/a.ts"]);
    expect([...late.unanswered]).toEqual(["src/a.ts"]);
    const tests = testTally(view, { ...late, untracked: new Set() }).counts;
    const report: CommitReport = { commit: "c".repeat(40), revision: 1, at: 0, tests };
    expect(full(report)).toEqual([
      "Commit ccccccc: 0 known failures; 1 test file not determined (git did not answer)",
      "  test/a.test.ts is not determined: git did not answer for src/a.ts",
    ]);
    expect(commitReportText(report)).not.toContain("unstaged changes");
  });
});

/** A view of one test file whose closure reads `src/a.ts`, with `hashes` as its keys' hashes. */
function slowView(root: string, hashes: ReadonlyMap<string, string>): CommitView {
  const testFile = { project: "", path: "test/a.test.ts" };
  return {
    hashOf: (path) => hashes.get(path),
    paths: () => hashes.keys(),
    closure: () => [testFile.path, "src/a.ts"],
    isEnvironmentInput: () => false,
    ignoredAmong: (paths) => checkIgnored(root, paths),
    testFiles: () => [{ worktreeId: "w", testFile, key: "k", revision: 1, pending: null }],
    states: () => [],
    knownTestFile: () => false,
    onDisk: async () => true,
    storedBlobs: (asked) => storedBlobs(root, asked),
  };
}

/** The report as `status --full` prints it. */
const full = (report: CommitReport): string[] => commitLines(commitLine(report), true);

/** Hands the scheduler one watch batch of `paths`, as the change feed would. */
async function watch(side: CatchUpSide, ...paths: string[]): Promise<void> {
  const hasher = createFsHasher(side.root, "sha1");
  await side.scheduler.handleBatch({
    trigger: "watch",
    paths: await statCandidates(paths, hasher),
  });
}

/** The idle reconciliation pass (spec 001 D2): not a watch batch, so it reports a moved `HEAD`. */
function pass(side: CatchUpSide): Promise<void> {
  return side.scheduler.handleBatch({ trigger: "interval", paths: [] });
}

function newest(side: CatchUpSide): CommitReport {
  const report = readCommitReports(side.store.meta, side.worktreeId)?.reports[0];
  if (report === undefined) throw new Error("no commit report");
  return report;
}

const counts = (report: CommitReport) => ("tests" in report ? report.tests : undefined);
