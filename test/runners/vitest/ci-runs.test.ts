import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import { type RawRun, readRawRuns, recordedRun } from "../../../src/runners/vitest/ci-runs.js";

/*
 * Spec 018 D8, row 018-16: the raw run `vitest-ci.cjs` writes and the part
 * body it becomes. Outcomes follow the daemon's reporter: an error at module
 * or suite level fails the file, an unhandled error naming the file fails it,
 * one naming no file trusts nothing, and a cancelled run lists no file.
 */

const ROOT = "/work/repo";
const paths = new WorktreePaths(ROOT);
const context = {
  paths,
  env: {},
  allowlist: [],
  squealVersion: "0.0.0",
  observing: false,
  recorded: null,
};

const diagnostic = {
  environmentSetupDuration: 1,
  prepareDuration: 1,
  collectDuration: 1,
  setupDuration: 1,
  duration: 6,
};

function module(name: string, overrides: Partial<RawRun["modules"][number]> = {}) {
  return {
    project: "",
    moduleId: `${ROOT}/test/${name}.test.ts`,
    state: "passed",
    diagnostic,
    errors: 0,
    tests: [
      {
        id: `${name}-1`,
        fullName: "works",
        location: { line: 3, column: 1 },
        state: "passed",
        durationMs: 2,
      },
    ],
    ...overrides,
  };
}

function run(overrides: Partial<RawRun> = {}): RawRun {
  return {
    vitest: "5.0.3",
    node: { version: "v24.0.0", platform: "linux", arch: "x64" },
    reason: "passed",
    unhandled: [],
    projects: [
      {
        name: "",
        config: {
          allowOnly: true,
          sequence: { seed: 1 },
          snapshotOptions: { updateSnapshot: "new" },
        },
        globalSetup: [],
      },
    ],
    modules: [module("a")],
    env: {},
    ...overrides,
  };
}

describe("recordedRun", () => {
  it("keeps a passed module as a pass with its checks and its duration", () => {
    const body = recordedRun(run(), context);
    expect(body.end).toBe("completed");
    expect(body.testFiles).toEqual([
      {
        project: "",
        path: "test/a.test.ts",
        outcome: "pass",
        durationMs: 10,
        checks: [
          { fullName: "works", outcome: "pass", durationMs: 2, location: { line: 3, column: 1 } },
        ],
      },
    ]);
    expect(body.projects[0]?.updateSnapshot).toBe("new");
    expect(body.projects[0]?.descriptor).toMatchObject({
      nodeVersion: "v24.0.0",
      runnerVersion: "5.0.3",
    });
  });

  it("fails a file for a suite or module error, a failed check, or an unhandled error naming it", () => {
    const failedCheck = module("c", {
      state: "failed",
      tests: [{ id: "c-1", fullName: "x", location: null, state: "failed", durationMs: 1 }],
    });
    const body = recordedRun(
      run({
        modules: [
          module("a", { errors: 1 }),
          module("b"),
          failedCheck,
          module("d", { state: "skipped" }),
        ],
        unhandled: [`${ROOT}/test/b.test.ts`],
      }),
      context,
    );
    expect(body.testFiles.map((f) => [f.path, f.outcome])).toEqual([
      ["test/a.test.ts", "fail"],
      ["test/b.test.ts", "fail"],
      ["test/c.test.ts", "fail"],
      ["test/d.test.ts", "skip"],
    ]);
  });

  it("lists no file from a run with an error outside every file, or a cancelled one", () => {
    expect(recordedRun(run({ unhandled: [null] }), context)).toMatchObject({
      end: "crashed",
      testFiles: [],
    });
    expect(recordedRun(run({ reason: "interrupted" }), context)).toMatchObject({
      end: "interrupted",
      testFiles: [],
    });
  });

  it("leaves out a module that did not end, a module outside the worktree, and a test that did not run", () => {
    const body = recordedRun(
      run({
        modules: [
          module("a", { state: "pending" }),
          { ...module("b"), moduleId: "/elsewhere/test/b.test.ts" },
          module("c", {
            tests: [
              { id: "c-1", fullName: "ran", location: null, state: "passed", durationMs: 1 },
              { id: "c-2", fullName: "never", location: null, state: "pending", durationMs: 0 },
            ],
          }),
        ],
      }),
      context,
    );
    expect(body.testFiles.map((f) => [f.path, f.checks.map((c) => c.fullName)])).toEqual([
      ["test/c.test.ts", ["ran"]],
    ]);
  });

  it("names a second test of one name by its line, as the daemon does", () => {
    const tests = [1, 2].map((n) => ({
      id: `a-${n}`,
      fullName: "same",
      location: { line: n * 10, column: 1 },
      state: "passed",
      durationMs: 1,
    }));
    const body = recordedRun(run({ modules: [module("a", { tests })] }), context);
    expect(body.testFiles[0]?.checks.map((c) => c.fullName)).toEqual(["same", "same (line 20)"]);
  });

  it("hashes allow-listed variables the Vitest process saw, never their values", () => {
    const seen = recordedRun(run({ env: { TOKEN: "secret" } }), {
      ...context,
      allowlist: ["TOKEN"],
    });
    const descriptor = seen.projects[0]?.descriptor;
    expect(descriptor?.env.names).toEqual(["TOKEN"]);
    expect(JSON.stringify(seen)).not.toContain("secret");
  });
});

describe("readRawRuns", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads ended runs with their RegExps and notes a process that ended none or could not record", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-ci-runs-"));
    dirs.push(dir);
    const ended = { ...run(), state: "ended" };
    const config = { sequence: {}, testNamePattern: { "squeal:regexp": "/a\\/b/i" } };
    const withRegExp = { ...ended, projects: [{ name: "", config, globalSetup: [] }] };
    writeFileSync(join(dir, "10.json"), JSON.stringify(withRegExp));
    writeFileSync(join(dir, "11.json"), JSON.stringify({ state: "started" }));
    writeFileSync(join(dir, "12.json"), JSON.stringify({ state: "failed", reason: "no Logger" }));
    writeFileSync(join(dir, "13.json"), "{");
    writeFileSync(join(dir, "14.json.tmp"), "{");
    const { runs, notes } = readRawRuns(dir);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.projects[0]?.config.testNamePattern).toEqual(/a\/b/i);
    expect(notes).toEqual([
      "Vitest process 11 ended without the end of a run; no part",
      "Vitest process 12: could not record (no Logger); no part",
      expect.stringMatching(/^Vitest process 13: its run file is not JSON/),
    ]);
  });
});
