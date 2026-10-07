import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompositeRunner } from "../../../src/core/daemon/composite-runner.js";
import { createNodeTestRunners } from "../../../src/core/daemon/node-test-runners.js";
import type {
  NodeTestProject,
  RunnerAdapter,
  RunnerEnvironment,
} from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Review wave 2, S1: a node:test project whose graph cannot be built, here
 * because its `cwd` is absent, is that project's runner failure only (spec
 * 003 D1: "a bad entry is a problem note with that project skipped, never a
 * crash"; goal 8). The other projects and Vitest keep listing and keying.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
let root = "";

beforeAll(() => {
  mkdirSync(scratch, { recursive: true });
  cpSync(join(FIXTURES, "reference"), join(scratch, "reference"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  root = realpathSync(join(scratch, "reference"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const project = (name: string, cwd: string): NodeTestProject => ({
  name,
  cwd,
  node: process.execPath,
  argv: ["--import", "tsx"],
  env: {},
  include: ["test/unit/*.test.ts"],
});

/** Stands in for the Vitest runner of the same worktree. */
const vitest: RunnerAdapter = {
  name: "vitest",
  adapterVersion: "v",
  invalidate: async () => ({ recreatedProjects: [] }),
  affected: async () => ({ direct: [], transitive: [] }),
  closure: async (testFile) => ({ testFile, paths: [testFile.path] }),
  enumerate: async () => [],
  testFiles: async () => [{ project: "", path: "src/sum.test.ts" }],
  environment: async (): Promise<RunnerEnvironment[]> => [
    {
      project: "",
      runnerName: "vitest",
      runnerVersion: "3",
      adapterVersion: "v",
      resolvedConfig: "{}",
      files: [],
    },
  ],
  run: async () => {
    throw new Error("not run here");
  },
  close: async () => {},
};

describe("a node:test project whose graph cannot be built (review wave 2, S1)", () => {
  it("leaves Vitest and the other projects listed beside a missing cwd", SLOW, async () => {
    const notes: string[] = [];
    const runners = createNodeTestRunners(
      [project("demo", "packages/demo"), project("gone", "packages/gone")],
      {
        root,
        store: open(fakeCommonDir()),
        tempDir: scratch,
        tierSize: () => 4,
        note: (text) => notes.push(text),
      },
    );
    const composite = createCompositeRunner([vitest, ...runners]);
    const files = await composite.testFiles();
    expect(files.map((f) => f.project)).toEqual(["", "demo", "demo"]);
    const environments = await composite.environment();
    expect(environments.map((e) => [e.project, e.runnerVersion])).toEqual([
      ["", "3"],
      ["demo", process.version],
      ["gone", "unavailable"],
    ]);
    expect(notes).toEqual([
      expect.stringMatching(/^node-test project "gone": .*packages\/gone.* is not a directory/),
    ]);
  });

  it("is recreated by the batch that adds its cwd", SLOW, async () => {
    const notes: string[] = [];
    const cwd = `packages/later-${randomUUID()}`;
    const adapter = await createNodeTestAdapter(project("later", cwd), {
      root,
      note: (text) => notes.push(text),
    });
    expect(await adapter.testFiles()).toEqual([]);
    expect(await adapter.affected([`${cwd}/src/a.ts`])).toEqual({ direct: [], transitive: [] });
    expect(
      await adapter.run([{ project: "later", path: `${cwd}/test/unit/a.test.ts` }], {
        runId: "r",
        logDir: join(scratch, "logs"),
        timeoutMs: 30_000,
      }),
    ).toMatchObject({ end: "crashed", completedFiles: [] });
    expect(await adapter.invalidate([{ path: "README.md", kind: "change" }])).toEqual({
      recreatedProjects: [],
    });
    expect(notes).toHaveLength(1);

    const testFile = `${cwd}/test/unit/a.test.ts`;
    mkdirSync(join(root, cwd, "test/unit"), { recursive: true });
    writeFileSync(join(root, cwd, "package.json"), `{"type":"module"}\n`);
    writeFileSync(
      join(root, testFile),
      `import { test } from "node:test";\ntest("later", () => {});\n`,
    );
    expect(await adapter.invalidate([{ path: testFile, kind: "add" }])).toEqual({
      recreatedProjects: ["later"],
    });
    expect(await adapter.testFiles()).toEqual([{ project: "later", path: testFile }]);
    expect((await adapter.environment())[0]?.runnerVersion).toBe(process.version);
    expect((await adapter.closure({ project: "later", path: testFile })).paths).toContain(testFile);
    expect(notes[1]).toMatch(/^node-test project "later": .* started/);
  });

  it("is a runner failure when its cwd is a file", SLOW, async () => {
    const notes: string[] = [];
    const adapter = await createNodeTestAdapter(project("file", "package.json"), {
      root,
      note: (text) => notes.push(text),
    });
    expect(await adapter.testFiles()).toEqual([]);
    expect((await adapter.environment())[0]?.runnerVersion).toBe("unavailable");
    expect(notes).toEqual([expect.stringMatching(/is not a directory/)]);
  });
});
