import { describe, expect, it } from "vitest";
import { missingRepository } from "../../../src/core/runner-host/remote/lane-repository.js";
import type { CheckError } from "../../../src/core/types/check.js";
import type { RunReport, StartupFailure } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Review 0.1.457 B1 and B2 (row 021-23, spec 021 D19.2): the guard knows a
 * missing repository by Git's own fatal line, in an error's message or in
 * one of its causes, for a test, a file and a setup alike. A failure that
 * only quotes the words, in an assertion or a stack, stays a remote failure,
 * and its file is not remembered as one that reads the repository.
 */

const GIT = { project: "", path: "test/git.test.ts" };
const FILES = { "test/git.test.ts": "import '../src/a';\n" };
const FATAL = "fatal: not a git repository (or any of the parent directories): .git";

const error = (message: string, extra: Partial<CheckError> = {}): CheckError => ({
  name: "Error",
  message,
  stack: null,
  location: null,
  diff: null,
  ...extra,
});
/** A wrapper whose cause is Git's diagnostic, as Vitest's `toCheckError` keeps it. */
const WRAPPED = error("could not read revision", { causes: [{ message: FATAL }] });

/** Real failures that quote Git's words: Vitest's assertion texts, and a stack alone. */
const QUOTED: readonly [string, CheckError][] = [
  [
    "an assertion on the words",
    error("expected 'not a git repository' to be 'invalid input' // Object.is equality"),
  ],
  [
    "an assertion on the whole fatal line",
    error(`expected '${FATAL}' to be '' // Object.is equality`),
  ],
  [
    "a stack alone",
    error("Command failed: git rev-parse HEAD", {
      stack: `Error: Command failed: git rev-parse HEAD\n${FATAL}\n    at test/git.test.ts:3:9`,
    }),
  ],
  ["a cause that quotes it", error("parse failed", { causes: [{ message: `got '${FATAL}'` }] })],
  [
    "Git that is not there",
    error("spawnSync git ENOENT", { causes: [{ message: "git: not found" }] }),
  ],
];

describe("Git's diagnostic for a missing repository (review 0.1.457 B1, B2)", () => {
  it.each([
    ["Node's failed command", `Command failed: git rev-parse HEAD\n${FATAL}\n`],
    ["Git's own line", FATAL],
    ["a mount point", "fatal: not a git repository (or any parent up to mount point /)"],
    ["a named directory, as Git before 2.x wrote it", "fatal: Not a git repository: '/srv/x/.git'"],
  ])("is %s", (_, message) => {
    expect(missingRepository(error(message))).toBe(true);
  });

  it("is in a cause, also one capped at 200 characters", () => {
    expect(missingRepository(WRAPPED)).toBe(true);
    const capped = `fatal: not a git repository (or any parent up to mount point /${"x".repeat(160)}`;
    const cut = error("wrapped", { causes: [{ message: capped.slice(0, 199) }] });
    expect(missingRepository(cut)).toBe(true);
  });

  it.each(QUOTED)("is not %s", (_, quoted) => {
    expect(missingRepository(quoted)).toBe(false);
  });
});

/** A remote run of `[REF, GIT]`: `REF` passes, and `GIT` fails as `fails` says. */
const remote = (fails: (report: RunReport) => RunReport) => async (): Promise<RunReport> =>
  fails({
    ...REPORT,
    completedFiles: [REF, GIT],
    results: [
      {
        check: { kind: "test", project: "", testPath: REF.path, fullName: "passes" },
        outcome: "pass",
        durationMs: 1,
        location: null,
        errors: [],
      },
    ],
    fileDurations: [
      { testFile: REF, durationMs: 1 },
      { testFile: GIT, durationMs: 1 },
    ],
    observed: [{ testFile: GIT, paths: ["src/a.ts"], directories: [] }],
  });

const testFails = (cause: CheckError) =>
  remote((report) => ({
    ...report,
    results: [
      ...report.results,
      {
        check: { kind: "test", project: "", testPath: GIT.path, fullName: "reads HEAD" },
        outcome: "fail",
        durationMs: 1,
        location: null,
        errors: [cause],
      },
    ],
  }));

const fileFails = (cause: CheckError) =>
  remote((report) => ({ ...report, fileErrors: [{ testFile: GIT, errors: [cause] }] }));

const STARTUP: StartupFailure = {
  projects: [""],
  testFiles: [REF, GIT],
  setupFile: "test/setup.ts",
  error: { ...WRAPPED, phase: "setup" },
};
const setupFails = remote(() => ({
  ...REPORT,
  failure: "global setup test/setup.ts failed",
  startupFailure: STARTUP,
}));

describe("the guard on a cause-wrapped missing repository (review 0.1.457 B2)", () => {
  it.each([
    ["a test", testFails(WRAPPED), [GIT]],
    ["a file", fileFails({ ...WRAPPED, phase: "load" }), [GIT]],
    ["a setup", setupFails, [REF, GIT]],
  ] as const)(
    "of %s keeps nothing of the remote's for the file, runs it here, names it, and keeps it here",
    async (_, run, rerun) => {
      const s = await setup({ files: FILES, remoteRun: run });
      const report = await s.lane.run([REF, GIT], background());
      const ofGit = (list: readonly { readonly testFile: { readonly path: string } }[] = []) =>
        list.filter((item) => item.testFile.path === GIT.path);
      expect(report.results.filter((r) => r.check.testPath === GIT.path)).toEqual([]);
      expect(ofGit(report.fileErrors)).toEqual([]);
      expect(ofGit(report.fileDurations)).toEqual([]);
      expect(ofGit(report.observed)).toEqual([]);
      expect(report.startupFailure).toBeUndefined();
      expect(s.localFiles).toEqual([rerun.map((f) => f.path).join(",")]);
      expect(report.completedFiles.filter((f) => f.path === GIT.path)).toEqual([GIT]);
      expect(s.repository.at(-1)).toContain(`run here: ${rerun.map((f) => f.path).join(", ")};`);
      await s.lane.run([GIT], background());
      expect(s.localFiles.at(-1)).toBe(GIT.path);
      expect(s.remoteRuns).toHaveLength(1);
    },
  );
});

describe("the guard on a failure that quotes Git (review 0.1.457 B1)", () => {
  it.each(QUOTED)(
    "keeps %s a remote failure, runs nothing here, and remembers nothing",
    async (_, quoted) => {
      const s = await setup({ files: FILES, remoteRun: testFails(quoted) });
      const report = await s.lane.run([REF, GIT], background());
      expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
        [REF.path, "pass"],
        [GIT.path, "fail"],
      ]);
      expect(report.results[1]?.errors).toEqual([quoted]);
      expect(report.completedFiles).toEqual([REF, GIT]);
      expect(s.localFiles).toEqual([]);
      expect(s.repository).toEqual([]);
      await s.lane.run([REF, GIT], background());
      expect(s.remoteRuns).toEqual([`${REF.path},${GIT.path}`, `${REF.path},${GIT.path}`]);
    },
  );

  it("keeps a quoting file error a remote failure too", async () => {
    const s = await setup({ files: FILES, remoteRun: fileFails(QUOTED[0]?.[1] ?? WRAPPED) });
    const report = await s.lane.run([REF, GIT], background());
    expect(report.fileErrors.map((e) => e.testFile)).toEqual([GIT]);
    expect(s.localFiles).toEqual([]);
    expect(s.repository).toEqual([]);
  });
});
