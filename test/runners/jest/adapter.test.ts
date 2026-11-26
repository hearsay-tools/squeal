import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import { createHostedJest } from "../../../src/core/runner-host/process-host.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { sourceHost } from "../../runner-host/process-helpers.js";

/*
 * Spec 028 D6 (row 028-05): the Jest adapter's whole lifecycle on real Jest
 * 29.7.0 and 30.5.2: listing, static closure and `affected`, enumeration,
 * `invalidate`, a run that reports `loaded` and `observed`, and the same
 * answers from a runner host.
 */

const PROJECT: JestProject = {
  name: "app",
  config: "jest.config.js",
  include: [],
  exclude: ["test/skipped.test.js"],
  args: [],
  env: {},
};

const CONFIG = (extra = "") => `module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.js"],
  setupFiles: ["<rootDir>/setup/env.js"],${extra}
};
`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": CONFIG(),
  "setup/env.js": "globalThis.ready = true;\n",
  "src/sum.js": "exports.sum = (a, b) => a + b;\n",
  "src/other.js": "exports.other = 2;\n",
  "data/input.txt": "3\n",
  "test/sum.test.js": `const fs = require("fs");
const path = require("path");
const { sum } = require("../src/sum");
describe("sum", () => {
  test("adds", () => {
    const want = Number(fs.readFileSync(path.join(__dirname, "../data/input.txt"), "utf8"));
    expect(sum(1, 2)).toBe(want);
  });
  test.each([[1], [2]])("each %i", (n) => expect(n).toBeGreaterThan(0));
});
`,
  "test/other.test.js": `const { other } = require("../src/other");\ntest("other", () => expect(other).toBe(2));\n`,
  "test/skipped.test.js": `test("never listed", () => {});\n`,
};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-adapter-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function worktree(major: JestMajor): AbsolutePath {
  const root = join(scratch, `tree-${made++}`);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  const installed = realpathSync(join(installJest(major), "node_modules/jest"));
  symlinkSync(installed, join(root, "node_modules/jest"));
  return root as AbsolutePath;
}

const ref = (path: string): TestFileRef => ({ project: "app", path });
const SUM = ref("test/sum.test.js");
const OTHER = ref("test/other.test.js");
const SLOW = { timeout: 240_000 };

async function runAll(adapter: RunnerAdapter, root: string, at: number): Promise<RunReport> {
  return adapter.run([SUM, OTHER], {
    runId: `run-${at}`,
    logDir: join(root, "..", `logs-${made}-${at}`) as AbsolutePath,
    timeoutMs: 120_000,
  });
}

describe.each(JEST_MAJORS)("the Jest %i adapter (spec 028 D6)", (major) => {
  it("lists, closes over, enumerates and selects statically", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root });
    expect(await adapter.testFiles()).toEqual([OTHER, SUM]);
    const closure = await adapter.closure(SUM);
    expect(closure.paths).toEqual(
      expect.arrayContaining([
        "test/sum.test.js",
        "src/sum.js",
        "setup/env.js",
        "test/__snapshots__/sum.test.js.snap",
      ]),
    );
    expect(closure.paths).not.toContain("src/other.js");
    expect(await adapter.affected(["src/sum.js"])).toEqual({ direct: [SUM], transitive: [] });
    // A setup file reaches every test file.
    const setup = await adapter.affected(["setup/env.js"]);
    expect(
      [...setup.direct, ...setup.transitive].sort((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([OTHER, SUM]);
    const checks = await adapter.enumerate(SUM);
    expect(checks.map((c) => [c.check.fullName, c.templated])).toEqual([
      ["sum > adds", false],
      ["sum > each %i", true],
    ]);
  });

  it("runs, reporting what each file loaded and read", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root });
    const report = await runAll(adapter, root, 0);
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual(expect.arrayContaining([SUM, OTHER]));
    const outcomes = Object.fromEntries(report.results.map((r) => [r.check.fullName, r.outcome]));
    expect(outcomes).toEqual({
      "sum > adds": "pass",
      "sum > each 1": "pass",
      "sum > each 2": "pass",
      other: "pass",
    });
    const loaded = report.loaded?.find((l) => l.testFile.path === SUM.path)?.paths ?? [];
    expect(loaded).toEqual(expect.arrayContaining(["test/sum.test.js", "src/sum.js"]));
    const read = report.observed?.find((o) => o.testFile.path === SUM.path)?.paths ?? [];
    expect(read).toContain("data/input.txt");
    expect(report.observed?.find((o) => o.testFile.path === OTHER.path)?.paths ?? []).not.toContain(
      "data/input.txt",
    );
  });

  it("observes nothing through the recorder when observe.runtimeInputs is off", SLOW, async () => {
    const root = worktree(major);
    const adapter = await createJestAdapter(PROJECT, { root, observe: () => false });
    const report = await runAll(adapter, root, 0);
    expect(report.end).toBe("completed");
    expect(report.observed).toBeUndefined();
    expect(report.loaded?.length).toBeGreaterThan(0);
  });

  it(
    "lists an added test file, and recreates the project when its config changes",
    SLOW,
    async () => {
      const root = worktree(major);
      let observe = true;
      const adapter = await createJestAdapter(PROJECT, { root, observe: () => observe });
      writeFileSync(join(root, "src/sum.js"), "exports.sum = (a, b) => a + b + 0;\n");
      expect(await adapter.invalidate([{ path: "src/sum.js", kind: "change" }])).toEqual({
        recreatedProjects: [],
      });
      writeFileSync(join(root, "test/added.test.js"), `test("added", () => {});\n`);
      expect(await adapter.invalidate([{ path: "test/added.test.js", kind: "add" }])).toEqual({
        recreatedProjects: [],
      });
      expect(await adapter.testFiles()).toEqual([ref("test/added.test.js"), OTHER, SUM]);
      const before = (await adapter.environment())[0]?.resolvedConfig;
      writeFileSync(join(root, "jest.config.js"), CONFIG("\n  testTimeout: 9000,"));
      expect(await adapter.invalidate([{ path: "jest.config.js", kind: "change" }])).toEqual({
        recreatedProjects: ["app"],
      });
      expect((await adapter.environment())[0]?.resolvedConfig).not.toBe(before);
      observe = false;
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["app"] });
    },
  );

  it("answers the same from a runner host", SLOW, async () => {
    const root = worktree(major);
    const here = await createJestAdapter(PROJECT, { root });
    const hosted = await createHostedJest(sourceHost(squealVersion()), PROJECT, { root });
    onTestFinished(() => hosted.close());
    expect(hosted.name).toBe("jest");
    expect(await hosted.testFiles()).toEqual(await here.testFiles());
    expect(await hosted.closure(SUM)).toEqual(await here.closure(SUM));
    expect(await hosted.environment()).toEqual(await here.environment());
    const report = await runAll(hosted, root, 1);
    expect(report.end).toBe("completed");
    expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
    expect(report.observed?.find((o) => o.testFile.path === SUM.path)?.paths).toContain(
      "data/input.txt",
    );
  });
});
