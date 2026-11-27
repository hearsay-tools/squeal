import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { testFileId } from "../../../src/core/keys/reverse-index.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import { type ObservedGrowth, observedGrowth } from "../../../src/core/scheduler/observed.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { initRepository, OpenWorktree } from "../../kit/worktrees.js";

/*
 * Row 028-08, findings F1 and F5, on real Jest 29.7.0 and 30.5.2 with the
 * recorder on: Jest's own transform (`babel-jest`, Browserslist) and
 * resolver probe absent files while a test file runs, and on a failure
 * `source-map-support` probes `node:internal/...`. None of those is the
 * test's input; recorded, each was first hashed during the run, so the
 * record dropped a cold run's results and ran every file again. A cold run
 * now sees no path first, a passing or a failing file alike, while a read
 * of the test's own code, an absent file too, is still observed.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: [],
  args: [],
  env: {},
};

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    "};",
  ),
  "src/add.js": "module.exports = (a, b) => a + b;\n",
  "test/pass.test.js": lines(
    'const add = require("../src/add");',
    'test("adds", () => expect(add(1, 2)).toBe(3));',
  ),
  "test/fail.test.js": lines(
    'const add = require("../src/add");',
    'test("fails", () => expect(add(1, 2)).toBe(4));',
  ),
  "test/user.test.js": lines(
    'const fs = require("fs");',
    'const path = require("path");',
    'const add = require("../src/add");',
    'test("absent", () => {',
    '  expect(fs.existsSync(path.join(__dirname, "../data/user-absent.txt"))).toBe(false);',
    "  expect(add(1, 1)).toBe(2);",
    "});",
  ),
};

/**
 * An ES module test file whose transform reads `types/esm.d.ts` and
 * `types/also.d.ts` and fails to read the absent `types/absent.d.ts`, as a
 * type checker may. Jest 29 transforms it with `processAsync`, which reads
 * with `fs.promises.readFile` and `fs.readFile`'s callback; Jest 30 on a Node
 * that evaluates ES modules synchronously, with `process`.
 */
const ESM_FILES: Readonly<Record<string, string>> = {
  "package.json": FILES["package.json"] as string,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.mjs"],',
    '  transform: { "\\\\.mjs$": "<rootDir>/transform/async.js" },',
    "};",
  ),
  "transform/async.js": lines(
    'const fs = require("fs");',
    'const path = require("path");',
    "const named = (text, tag, from) => {",
    '  const line = text.split("\\n").find((l) => l.startsWith("// @" + tag + " "));',
    '  return line === undefined ? null : path.resolve(path.dirname(from), line.split(" ")[2]);',
    "};",
    "module.exports = {",
    "  process(sourceText, sourcePath) {",
    '    for (const tag of ["types", "also", "maybe"]) {',
    "      const file = named(sourceText, tag, sourcePath);",
    "      try {",
    "        if (file !== null) fs.readFileSync(file);",
    "      } catch {}",
    "    }",
    "    return { code: sourceText };",
    "  },",
    "  async processAsync(sourceText, sourcePath) {",
    '    const types = named(sourceText, "types", sourcePath);',
    '    if (types !== null) await fs.promises.readFile(types, "utf8");',
    '    const also = named(sourceText, "also", sourcePath);',
    "    if (also !== null) {",
    "      await new Promise((done, fail) =>",
    '        fs.readFile(also, "utf8", (err) => (err ? fail(err) : done())),',
    "      );",
    "    }",
    '    const maybe = named(sourceText, "maybe", sourcePath);',
    "    if (maybe !== null) await fs.promises.readFile(maybe).catch(() => null);",
    "    return { code: sourceText };",
    "  },",
    "};",
  ),
  "types/esm.d.ts": "export declare const esm: number;\n",
  "types/also.d.ts": "export declare const also: number;\n",
  "src/add.mjs": "export const add = (a, b) => a + b;\n",
  "test/esm.test.mjs": lines(
    "// @types ../types/esm.d.ts",
    "// @also ../types/also.d.ts",
    "// @maybe ../types/absent.d.ts",
    'import { add } from "../src/add.mjs";',
    'test("esm", () => expect(add(2, 2)).toBe(4));',
  ),
};

const ESM_PROJECT: JestProject = {
  ...PROJECT,
  env: { NODE_OPTIONS: "--experimental-vm-modules --no-warnings" },
};

const PASS = ref("test/pass.test.js");
const FAIL = ref("test/fail.test.js");
const USER = ref("test/user.test.js");
const SLOW = { timeout: 240_000 };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-cold-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function ref(path: string): TestFileRef {
  return { project: "app", path };
}

function worktree(
  major: JestMajor,
  files: Readonly<Record<string, string>> = FILES,
): { root: AbsolutePath; common: AbsolutePath } {
  const dir = join(scratch, `tree-${made++}`);
  const root = join(dir, "worktree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const jest = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(jest, join(root, "node_modules/jest"));
  mkdirSync(join(dir, "common"));
  initRepository(root);
  return {
    root: realpathSync(root) as AbsolutePath,
    common: realpathSync(join(dir, "common")) as AbsolutePath,
  };
}

/** The keys behind an open worktree, which the kit keeps to itself. */
const keysOf = (open: OpenWorktree) => (open as unknown as { readonly keys: WorktreeKeys }).keys;

/**
 * Runs `files` in one batch, keyed first, as the scheduler runs a tier, and
 * returns what the record's `observedGrowth` sees of each completed file.
 */
async function coldRun(
  open: OpenWorktree,
  root: AbsolutePath,
  files: readonly TestFileRef[],
): Promise<{ report: RunReport; growth: Map<string, ObservedGrowth> }> {
  const keys = keysOf(open);
  for (const file of files) await open.keyed(file);
  const run = keys.beginRun();
  try {
    const report = await open.adapter.run(files, {
      runId: `run-${made}`,
      logDir: join(root, "..", `logs-${made++}`) as AbsolutePath,
      timeoutMs: 120_000,
    });
    const growth = await observedGrowth({ root, keys }, report, run);
    return { report, growth };
  } finally {
    keys.endRun();
  }
}

const byPath = (growth: Map<string, ObservedGrowth>, file: TestFileRef) =>
  growth.get(testFileId(file));

const observedOf = (report: RunReport, file: TestFileRef): readonly RelativePath[] =>
  report.observed?.find((o) => o.testFile.path === file.path)?.paths ?? [];

describe.each(JEST_MAJORS)("a cold Jest %i run with the recorder on", (major) => {
  it("sees no path first for a passing or a failing file, so its results stand", SLOW, async () => {
    const { root, common } = worktree(major);
    const open = await OpenWorktree.open("a", root, common, () =>
      createJestAdapter(PROJECT, { root, batchSize: () => 5 }),
    );
    onTestFinished(() => open.close());

    const { report, growth } = await coldRun(open, root, [PASS, FAIL, USER]);
    expect(report.completedFiles.map((f) => f.path).sort()).toEqual(
      [FAIL.path, PASS.path, USER.path].sort(),
    );
    expect(Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]))).toEqual({
      adds: "pass",
      fails: "fail",
      absent: "pass",
    });
    for (const file of [PASS, FAIL]) {
      expect(byPath(growth, file)?.firstSeen ?? []).toEqual([]);
      const observed = observedOf(report, file);
      expect(observed.filter((p) => p.includes("node:"))).toEqual([]);
      expect(observed.filter((p) => /babel|browserslist|browserlist/.test(p))).toEqual([]);
      expect(observed).not.toContain("src/add");
      expect(observed).not.toContain("src/package.json");
    }
    // The test's own read of an absent file is its input, first seen as before.
    expect(observedOf(report, USER)).toContain("data/user-absent.txt");
    expect(byPath(growth, USER)?.firstSeen).toEqual(["data/user-absent.txt"]);
  });
});

describe.each(JEST_MAJORS)("an async transform's reads on a cold Jest %i run", (major) => {
  it("are observed when they succeed and seen first by none", SLOW, async () => {
    const { root, common } = worktree(major, ESM_FILES);
    const open = await OpenWorktree.open("a", root, common, () =>
      createJestAdapter(ESM_PROJECT, { root, batchSize: () => 5 }),
    );
    onTestFinished(() => open.close());

    const esm = ref("test/esm.test.mjs");
    const { report, growth } = await coldRun(open, root, [esm]);
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["esm", "pass"]]);
    const observed = observedOf(report, esm);
    expect(observed).toEqual(expect.arrayContaining(["types/esm.d.ts", "types/also.d.ts"]));
    expect(observed).not.toContain("types/absent.d.ts");
    expect(byPath(growth, esm)?.firstSeen ?? []).toEqual([]);
  });
});
