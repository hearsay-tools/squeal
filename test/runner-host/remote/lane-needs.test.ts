import { describe, expect, it } from "vitest";
import {
  notARepository,
  withoutFiles,
} from "../../../src/core/runner-host/remote/lane-repository.js";
import type { CheckRunResult, RunReport } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Spec 021 D19 (row 021-23): what tests need, on a lane over a host served
 * in this process. A command missing on the remote refuses it at connect,
 * named, and its runs go as `whenLost` says. A `needsRepository` file never
 * goes remote. A remote failure with Git's "not a git repository" fatal
 * line keeps no result: the file runs here, then stays here, and is named.
 * Review 0.1.457's controls are in `lane-guard.test.ts` and
 * `lane-setup.test.ts`.
 */

const GIT = { project: "", path: "test/git.test.ts" };
const FILES = { "test/git.test.ts": "import '../src/a';\n" };
const MISSING = "tests need python3; not found on PATH there";
const GIT_TEXT =
  "Command failed: git rev-parse HEAD\nfatal: not a git repository (or any of the parent directories): .git";

function result(path: string, message: string | null): CheckRunResult {
  return {
    check: { kind: "test", project: "", testPath: path, fullName: "reads HEAD" },
    outcome: message === null ? "pass" : "fail",
    durationMs: 1,
    location: null,
    errors:
      message === null ? [] : [{ name: "Error", message, stack: null, location: null, diff: null }],
  };
}

/** A remote run of `[REF, GIT]`: `REF` passes, `GIT` fails with `message`. */
const remoteFails = (message: string) => async (): Promise<RunReport> => ({
  ...REPORT,
  completedFiles: [REF, GIT],
  results: [result(REF.path, null), result(GIT.path, message)],
  fileDurations: [
    { testFile: REF, durationMs: 1 },
    { testFile: GIT, durationMs: 1 },
  ],
});

const paths = (report: RunReport) => report.completedFiles.map((file) => file.path);

describe("requires.commands on a remote (021 D19.1)", () => {
  it("refuses a remote that lacks a command at connect, named, and runs its files here", async () => {
    const s = await setup({ refusal: MISSING });
    expect(s.statuses.at(-1)).toBe(`remote box refused: ${MISSING}; running here`);
    const report = await s.lane.run([REF], background());
    expect(paths(report)).toEqual([REF.path]);
    expect(s.remoteRuns).toEqual([]);
    expect(s.localFiles).toEqual([REF.path]);
  });

  it("leaves them not run under whenLost not-run, named the same", async () => {
    const s = await setup({ refusal: MISSING, whenLost: "not-run" });
    const report = await s.lane.run([REF], background());
    expect(report.completedFiles).toEqual([]);
    expect(s.localFiles).toEqual([]);
    expect(s.statuses.at(-1)).toBe(`remote box refused: ${MISSING}; 1 files not run`);
  });
});

describe("remote.needsRepository (021 D19.2)", () => {
  it("runs a file that needs the repository here, first, and the rest of its tier remote", async () => {
    const s = await setup({ needsRepository: ["test/git.*"], files: FILES });
    const report = await s.lane.run([REF, GIT], background());
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localFiles).toEqual([GIT.path]);
    expect(s.localRuns[0]?.logDir).toMatch(/[/\\]repository$/);
    expect(paths(report)).toEqual([GIT.path, REF.path]);
    await s.lane.run([GIT], background());
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localFiles).toEqual([GIT.path, GIT.path]);
  });

  it("runs it here also while the remote is refused under whenLost not-run", async () => {
    const s = await setup({
      needsRepository: ["test/git.*"],
      files: FILES,
      refusal: MISSING,
      whenLost: "not-run",
    });
    const report = await s.lane.run([REF, GIT], background());
    expect(paths(report)).toEqual([GIT.path]);
    expect(s.localFiles).toEqual([GIT.path]);
    expect(s.remoteRuns).toEqual([]);
  });
});

describe("the guard on a remote 'not a git repository' failure (021 D19.2)", () => {
  it("stores no remote result for the file, runs it here, names it, and keeps it here", async () => {
    const s = await setup({ files: FILES, remoteRun: remoteFails(GIT_TEXT) });
    const report = await s.lane.run([REF, GIT], background());
    expect(s.remoteRuns).toEqual([`${REF.path},${GIT.path}`]);
    expect(s.localFiles).toEqual([GIT.path]);
    expect(s.localRuns[0]?.logDir).toMatch(/[/\\]here$/);
    // REF's remote pass stays; GIT's remote failure is gone, its result is the run here.
    expect(report.results).toEqual([result(REF.path, null)]);
    expect(paths(report)).toEqual([REF.path, GIT.path]);
    expect(report.fileDurations).toEqual([{ testFile: REF, durationMs: 1 }]);
    expect(s.repository).toEqual([
      "test files that failed on the remote as not a Git repository run here: test/git.test.ts; add each to remote.needsRepository in squeal.config.json",
    ]);
    expect(s.logs).toContain(
      "remote box: test/git.test.ts failed there as not a Git repository; running here",
    );
    await s.lane.run([REF, GIT], background());
    expect(s.remoteRuns.at(-1)).toBe(REF.path);
    expect(s.localFiles.at(-1)).toBe(GIT.path);
  });

  it("keeps a remote failure without Git's text", async () => {
    const s = await setup({ files: FILES, remoteRun: remoteFails("expected 1 to be 2") });
    const report = await s.lane.run([REF, GIT], background());
    expect(report.results.map((r) => r.outcome)).toEqual(["pass", "fail"]);
    expect(s.localFiles).toEqual([]);
    expect(s.repository).toEqual([]);
  });
});

describe("a report's files that failed as not a Git repository (021 D19.2)", () => {
  const error = (message: string, stack: string | null = null) => ({
    name: "Error",
    message,
    stack,
    location: null,
    diff: null,
  });

  it("finds Git's fatal line in a failure, a file error or a setup failure", () => {
    expect(notARepository({ ...REPORT, results: [result(GIT.path, GIT_TEXT)] })).toEqual([GIT]);
    expect(
      notARepository({ ...REPORT, fileErrors: [{ testFile: GIT, errors: [error(GIT_TEXT)] }] }),
    ).toEqual([GIT]);
    const startupFailure = {
      projects: [""],
      testFiles: [REF, GIT],
      setupFile: "test/setup.ts",
      error: error("fatal: Not a git repository: '.git'"),
    };
    expect(notARepository({ ...REPORT, startupFailure })).toEqual([REF, GIT]);
    expect(notARepository({ ...REPORT, results: [result(GIT.path, "git: not found")] })).toEqual(
      [],
    );
  });

  it("drops everything of the named files from a report, and a setup failure of theirs alone", () => {
    const report: RunReport = {
      ...REPORT,
      completedFiles: [REF, GIT],
      results: [result(REF.path, null), result(GIT.path, GIT_TEXT)],
      fileErrors: [{ testFile: GIT, errors: [error(GIT_TEXT)] }],
      fileDurations: [
        { testFile: REF, durationMs: 1 },
        { testFile: GIT, durationMs: 2 },
      ],
      observed: [{ testFile: GIT, paths: [".git/HEAD"], directories: [] }],
      skippedFiles: [{ testFile: GIT, reason: "skip" }],
      withheld: [GIT],
      focused: [{ testFile: GIT, collected: 1, matched: 1 }],
      startupFailure: {
        projects: [""],
        testFiles: [GIT],
        setupFile: null,
        error: error(GIT_TEXT),
      },
    };
    expect(withoutFiles(report, [GIT])).toEqual({
      ...REPORT,
      completedFiles: [REF],
      results: [result(REF.path, null)],
      fileErrors: [],
      fileDurations: [{ testFile: REF, durationMs: 1 }],
      observed: [],
      skippedFiles: [],
      withheld: [],
      focused: [],
    });
    expect(withoutFiles(REPORT, [GIT])).toEqual(REPORT);
  });
});
