import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckError } from "../../../../src/core/types/check.js";
import type { AbsolutePath, RelativePath } from "../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../src/core/types/keys.js";
import type { JestProject } from "../../../../src/core/types/policy-jest.js";
import type { CheckRunResult, RunReport } from "../../../../src/core/types/runner.js";
import { type JestInstall, resolveJest } from "../../../../src/runners/jest/resolve.js";
import { type JestRunOptions, runJest } from "../../../../src/runners/jest/run/index.js";
import { observeRecorder } from "../../../../src/runners/observe/runtime.js";
import { installJest, JEST_MAJORS } from "../../../helpers/jest-env.js";

/*
 * Spec 028 D4, D5 (row 028-03) on real Jest 29.7.0 and 30.5.2: a fixture
 * project per case, its `node_modules` a link to the shared pnpm install.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-run-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CONFIG = `module.exports = { testEnvironment: "node", testMatch: ["<rootDir>/test/**/*.test.js"] };\n`;
const SNAP_HEADER = "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n\n";

let trees = 0;
/** A project folder holding `files` and a link to the install's `node_modules`. */
function project(install: string, files: Record<string, string>): AbsolutePath {
  const root = join(scratch, `p${trees++}`);
  for (const [path, text] of Object.entries({ "jest.config.js": CONFIG, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  symlinkSync(join(install, "node_modules"), join(root, "node_modules"));
  return root as AbsolutePath;
}

function jestProject(name: string, extra: Partial<JestProject> = {}): JestProject {
  return { name, config: "jest.config.js", include: [], exclude: [], args: [], env: {}, ...extra };
}

const ref = (name: string, path: string): TestFileRef => ({
  project: name,
  path: path as RelativePath,
});

function run(
  root: AbsolutePath,
  install: JestInstall,
  name: string,
  paths: readonly string[],
  extra: Partial<JestRunOptions> = {},
) {
  return runJest({
    root,
    install,
    project: jestProject(name),
    files: paths.map((p) => ref(name, p)),
    logDir: join(root, ".squeal-log", `run${trees++}`) as AbsolutePath,
    timeoutMs: 60_000,
    cacheDir: join(scratch, "cache") as AbsolutePath,
    observeRuntimePath: null,
    ...extra,
  });
}

function byName(results: readonly CheckRunResult[]): Record<string, CheckRunResult> {
  return Object.fromEntries(results.map((r) => [r.check.fullName, r]));
}

const MANY = `describe("group", () => {
  test("dup", () => { expect(1).toBe(1); });
  test("dup", () => { expect(1).toBe(2); });
  test.each([1, 1])("each %i", (n) => { expect(n).toBe(1); });
  test.skip("skipped", () => {});
  test.todo("later");
});
`;

const TIER: Record<string, string> = {
  "test/many.test.js": MANY,
  "test/syntax.test.js": `test("x", () => { expect(1).toBe(1) ;\n`,
  "test/throws.test.js": `throw new Error("boom at load");\n`,
  "test/snap.test.js": `test("kept", () => { expect(1).toMatchSnapshot(); });
test("changed", () => { expect("new").toMatchSnapshot(); });
test("missing", () => { expect(3).toMatchSnapshot(); });
`,
  "test/__snapshots__/snap.test.js.snap": `${SNAP_HEADER}exports[\`changed 1\`] = \`"old"\`;\n\nexports[\`kept 1\`] = \`1\`;\n\nexports[\`obsolete 1\`] = \`2\`;\n`,
};

describe.each(JEST_MAJORS)("runJest on Jest %i (spec 028 D4, D5)", (major) => {
  let installed = "";
  let install: JestInstall;
  beforeAll(() => {
    installed = installJest(major);
    const resolved = resolveJest("fixture", installed as AbsolutePath, installed as AbsolutePath);
    if (!resolved.ok) throw new Error(resolved.note);
    install = resolved.install;
  }, 240_000);

  describe("one tier of four files in two batches", () => {
    let root = "" as AbsolutePath;
    let report: RunReport;
    let results: Record<string, CheckRunResult> = {};
    let fileErrors: Record<string, readonly CheckError[]> = {};
    const files = [
      "test/many.test.js",
      "test/syntax.test.js",
      "test/throws.test.js",
      "test/snap.test.js",
    ];
    beforeAll(async () => {
      root = project(installed, TIER);
      ({ report } = await run(root, install, "tier", files, { batchSize: 2, concurrency: 2 }));
      results = byName(report.results);
      fileErrors = Object.fromEntries(report.fileErrors.map((e) => [e.testFile.path, e.errors]));
    }, 120_000);

    it("completes every file", () => {
      expect(report.end).toBe("completed");
      expect(report.failure).toBeNull();
      expect(report.completedFiles.map((f) => f.path).sort()).toEqual([...files].sort());
      expect(report.fileDurations?.length).toBe(4);
    });

    it("names checks by ancestors and title, duplicates by line (D5.2)", () => {
      const names = Object.keys(results).filter((n) => n.startsWith("group"));
      expect(names.sort()).toEqual([
        "group > dup",
        "group > dup (line 3)",
        "group > each 1",
        "group > each 1 (line 4)",
        "group > later",
        "group > skipped",
      ]);
      const outcomes = Object.fromEntries(names.map((n) => [n, results[n]?.outcome]));
      expect(outcomes).toEqual({
        "group > dup": "pass",
        "group > dup (line 3)": "fail",
        "group > each 1": "pass",
        "group > each 1 (line 4)": "pass",
        "group > later": "skip",
        "group > skipped": "skip",
      });
    });

    it("maps a failed assertion with its location, no ANSI and no worktree path", () => {
      const failed = results["group > dup (line 3)"];
      expect(failed?.location).toEqual({ path: "test/many.test.js", line: 3, column: 3 });
      const error = failed?.errors[0];
      expect(error).toMatchObject({
        assertionEvidence: true,
        location: { path: "test/many.test.js", line: 3 },
      });
      expect(error?.message).toContain("Expected: 2");
      expect(error?.stack).not.toContain(root);
      expect(error?.stack).not.toContain("\u001b[");
    });

    it("fails a changed and a missing snapshot under --ci and writes none", () => {
      expect(results.kept?.outcome).toBe("pass");
      expect(results.changed?.errors[0]?.message).toContain("Snapshot name: `changed 1`");
      expect(results.missing?.errors[0]?.message).toContain("New snapshot was not written");
      const snap = readFileSync(join(root, "test/__snapshots__/snap.test.js.snap"), "utf8");
      expect(snap).not.toContain("missing 1");
    });

    it("reports a syntax error, a throw at load and an obsolete snapshot as file errors", () => {
      expect(fileErrors["test/many.test.js"]).toBeUndefined();
      const syntax = fileErrors["test/syntax.test.js"]?.[0];
      expect(syntax).toMatchObject({ name: "SyntaxError", phase: "load" });
      expect(syntax?.message).toContain("test/syntax.test.js");
      expect(syntax?.message).not.toContain(root);
      expect(fileErrors["test/throws.test.js"]?.[0]).toMatchObject({
        name: "Error",
        message: "boom at load",
        phase: "load",
        location: { path: "test/throws.test.js", line: 1 },
      });
      const obsolete = fileErrors["test/snap.test.js"]?.[0];
      expect(obsolete).toMatchObject({ name: "ObsoleteSnapshot", phase: "after-tests" });
      expect(obsolete?.message).toContain('"obsolete 1"');
    });
  });

  it("expands the project's env templates per slot before childEnv, with NODE_ENV=test", async () => {
    const check = (n: number) =>
      `test("env ${n}", () => {
  expect(process.env.DB).toBe("db_" + process.env.SQUEAL_SLOT);
  expect(process.env.TOKEN).toBe(process.env.SQUEAL_WORKTREE_SLOT);
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.OVER).toBe("child");
  expect(process.env.SQUEAL_JEST_EVENTS).toMatch(/events-\\d+\\.jsonl$/);
});\n`;
    const root = project(installed, { "test/a.test.js": check(1), "test/b.test.js": check(2) });
    const name = `slots-${major}`;
    const { report } = await run(root, install, name, ["test/a.test.js", "test/b.test.js"], {
      project: jestProject(name, {
        env: { DB: "db_{slot}", TOKEN: "{worktreeSlot}", OVER: "project" },
      }),
      batchSize: 1,
      concurrency: 2,
      runEnv: { ...process.env, NODE_ENV: undefined },
      childEnv: { OVER: "child" },
    });
    expect(report.fileErrors).toEqual([]);
    expect(report.results.map((r) => [r.check.fullName, r.outcome, r.errors[0]?.message])).toEqual([
      ["env 1", "pass", undefined],
      ["env 2", "pass", undefined],
    ]);
  }, 120_000);

  it("keeps a file completed before a stop and drops the interrupted one (Kit K8)", async () => {
    // Jest runs the larger file first when it has no timings, so the padded file completes first.
    const root = project(installed, {
      "test/done.test.js": `test("done", () => { expect(1).toBe(1); });\n${"// pad\n".repeat(400)}`,
      "test/hang.test.js": `test("hang", () => { require("fs").writeFileSync(process.env.MARK, "x"); return new Promise(() => {}); }, 600000);\n`,
    });
    const mark = join(root, "hang.mark");
    const stop = new AbortController();
    const poll = setInterval(() => existsSync(mark) && stop.abort(), 50);
    const logDir = join(root, ".squeal-log", "k8") as AbsolutePath;
    const started = Date.now();
    const { report } = await run(root, install, "k8", ["test/done.test.js", "test/hang.test.js"], {
      signal: stop.signal,
      logDir,
      runEnv: { ...process.env, MARK: mark },
    }).finally(() => clearInterval(poll));

    expect(Date.now() - started).toBeLessThan(30_000);
    expect(report.end).toBe("completed");
    expect(report.completedFiles.map((f) => f.path)).toEqual(["test/done.test.js"]);
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["done", "pass"]]);
    // The interrupted file had started: its `fileStart` line is there, and dropped.
    expect(readFileSync(join(logDir, "events-0.jsonl"), "utf8")).toContain("hang.test.js");
  }, 120_000);

  it("ends timed-out on the deadline, keeping what completed", async () => {
    const root = project(installed, {
      "test/hang.test.js": `test("hang", () => new Promise(() => {}), 600000);\n`,
    });
    const { report } = await run(root, install, "deadline", ["test/hang.test.js"], {
      timeoutMs: 3_000,
    });
    expect(report.end).toBe("timed-out");
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toContain(
      "deadline of 3000 ms passed with 1 of 1 test files unfinished",
    );
  }, 120_000);

  it("reads an .mjs async config and a package.json jest key, rootDir kept", async () => {
    const tests = { "test/sum.test.js": `test("sum", () => { expect(1 + 2).toBe(3); });\n` };
    const mjs = project(installed, {
      ...tests,
      "config/jest.config.mjs": `export default async () => ({ testEnvironment: "node", rootDir: ".." });\n`,
    });
    const pkg = project(installed, {
      ...tests,
      "package.json": JSON.stringify({ name: "pkg", jest: { testEnvironment: "node" } }),
    });
    for (const [root, config] of [
      [mjs, "config/jest.config.mjs"],
      [pkg, "package.json"],
    ] as const) {
      const { report } = await run(root, install, "formats", ["test/sum.test.js"], {
        project: jestProject("formats", { config, cwd: "." }),
      });
      expect(report.failure).toBeNull();
      expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["sum", "pass"]]);
    }
  }, 120_000);

  it("reads a .ts config as Jest itself does: natively on 30, through ts-node on 29", async () => {
    const root = project(installed, {
      "test/sum.test.js": `test("sum", () => { expect(1 + 2).toBe(3); });\n`,
      "jest.config.ts": `const config: { testEnvironment: string } = { testEnvironment: "node" };\nexport default config;\n`,
    });
    const { report } = await run(root, install, "ts", ["test/sum.test.js"], {
      project: jestProject("ts", { config: "jest.config.ts" }),
    });
    if (major === 30) {
      expect(report.failure).toBeNull();
      expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["sum", "pass"]]);
    } else {
      // The fixture has no ts-node; the failure carries Jest's own words for it.
      expect(report.end).toBe("crashed");
      expect(report.failure).toContain(
        "'ts-node' is required for the TypeScript configuration files",
      );
    }
  }, 120_000);

  it("loads Squeal's recorder into the batch when the run observes", async () => {
    // Row 028-04's runtime names the current test file; until then the recorder only loads.
    const recorder = observeRecorder();
    if (recorder === null) throw new Error("recorder.cjs not found");
    const root = project(installed, {
      "test/env.test.js": `test("observed", () => {
  expect(process.env.NODE_OPTIONS).toContain(${JSON.stringify(recorder)});
  expect(JSON.parse(process.env.SQUEAL_OBSERVE)).toMatchObject({ out: process.env.OUT, root: process.env.ROOT });
});\n`,
    });
    const out = join(root, ".observed");
    const { report } = await run(root, install, "observe", ["test/env.test.js"], {
      observe: { recorder, out: out as AbsolutePath, skip: [] },
      runEnv: { ...process.env, OUT: out, ROOT: root },
    });
    expect(report.results.map((r) => [r.outcome, r.errors[0]?.message])).toEqual([
      ["pass", undefined],
    ]);
  }, 120_000);

  it("reports files Jest never ran as unfinished, naming the exit", async () => {
    const root = project(installed, {
      "test/sum.test.js": `test("sum", () => {});\n`,
      "broken.config.js": `throw new Error("broken config");\n`,
    });
    const { report } = await run(root, install, "broken", ["test/sum.test.js"], {
      project: jestProject("broken", { config: "broken.config.js" }),
    });
    expect(report.end).toBe("crashed");
    expect(report.completedFiles).toEqual([]);
    expect(report.failure).toMatch(
      /^jest ended without a result for test\/sum\.test\.js \(exit code 1: /,
    );
    expect(report.failure).toContain("broken config");
  }, 120_000);
});
