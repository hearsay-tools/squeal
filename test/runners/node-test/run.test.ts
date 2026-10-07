import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject, TestFileRef } from "../../../src/core/types/index.js";
import { type NodeTestRunOptions, runNodeTest } from "../../../src/runners/node-test/run/run.js";

/**
 * Live runs of `runNodeTest` against the node:test fixtures under the Node
 * running this suite (spec 003 D5). The fixtures resolve tsx from the
 * repository's `node_modules`, so scratch projects go under the fixtures'
 * git-ignored `.tmp/`.
 */

const ROOT = realpathSync(resolve(import.meta.dirname, "../../fixtures/node-test"));
const SLOW = { timeout: 60_000 } as const;
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-run-"));
const scratch = join(ROOT, ".tmp", randomUUID());
afterAll(() => {
  rmSync(logs, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const project = (name: string, cwd: string, argv: string[], more: Partial<NodeTestProject> = {}) =>
  ({ name, cwd, argv, env: {}, include: ["**/*.test.ts"], ...more }) as NodeTestProject;
const files = (p: NodeTestProject, ...paths: string[]): TestFileRef[] =>
  paths.map((path) => ({ project: p.name, path: `${p.cwd}/${path}` }));
const run = (
  options: Omit<NodeTestRunOptions, "root" | "logDir" | "timeoutMs"> & {
    timeoutMs?: number | null;
  },
) => runNodeTest({ root: ROOT, logDir: join(logs, randomUUID()), timeoutMs: 30_000, ...options });
const names = (results: readonly { check: { fullName: string }; outcome: string }[]) =>
  results.map((r) => `${r.check.fullName}: ${r.outcome}`);

const edge = project("edge", "edge", ["--import", "tsx"]);

describe("runNodeTest", () => {
  it("runs each file in its own process and maps results and file-level errors", SLOW, async () => {
    const tier = files(edge, "test/pass.test.ts", "test/fail.test.ts", "test/syntax.test.ts");
    tier.push(...files(edge, "test/missing-import.test.ts", "test/duplicate.test.ts"));
    const logDir = join(logs, randomUUID());
    const { report } = await runNodeTest({
      root: ROOT,
      project: edge,
      files: tier,
      logDir,
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "completed", failure: null, completedFiles: tier });
    expect(names(report.results)).toEqual([
      "passes: pass",
      "passes beside the failure: pass",
      "fails: fail",
      "suite > same name: pass",
      "suite > same name (line 6): pass",
      "same name: pass",
      "same name (line 9): pass",
    ]);
    expect(report.fileErrors.map((e) => [e.testFile.path, e.errors.length])).toEqual([
      ["edge/test/syntax.test.ts", 1],
      ["edge/test/missing-import.test.ts", 1],
    ]);
    const [syntax, missing] = report.fileErrors.map((e) => e.errors[0]);
    expect(syntax?.message).toMatch(/edge\/test\/syntax\.test\.ts:3:14: ERROR: Unexpected "="/);
    expect(syntax?.location).toEqual({ path: "edge/test/syntax.test.ts", line: 3, column: 14 });
    expect(missing?.message).toMatch(/ERR_MODULE_NOT_FOUND.*edge\/src\/does-not-exist\.js/);
    expect(report.fileDurations?.map((d) => d.testFile)).toEqual(tier);
    for (const log of ["run.json", "events-0.ndjson", "stderr-2.log", "stdout-0.log"]) {
      expect(existsSync(join(logDir, log))).toBe(true);
    }
  });

  it("kills a busy loop at the deadline and keeps the file that finished", SLOW, async () => {
    const tier = files(edge, "test/busy-loop.test.ts", "test/pass.test.ts");
    const started = performance.now();
    const { report } = await run({ project: edge, files: tier, timeoutMs: 8_000 });
    expect(performance.now() - started).toBeLessThan(8_000 + 2_000 + 5_000);
    expect(report.end).toBe("timed-out");
    expect(report.failure).toMatch(/deadline of 8000 ms passed with 1 of 2 test files unfinished/);
    expect(report.completedFiles).toEqual(files(edge, "test/pass.test.ts"));
    expect(names(report.results)).toEqual(["passes: pass"]);
  });

  it("does not start files left in the queue when the deadline passes", SLOW, async () => {
    const tier = files(edge, "test/busy-loop.test.ts", "test/pass.test.ts");
    const { report } = await run({ project: edge, files: tier, timeoutMs: 3_000, concurrency: 1 });
    expect(report).toMatchObject({ end: "timed-out", completedFiles: [], results: [] });
  });

  it("is crashed when a process dies before any wrapper completed", SLOW, async () => {
    mkdirSync(scratch, { recursive: true });
    const dies = join(scratch, "node-that-dies");
    writeFileSync(dies, "#!/bin/sh\nkill -KILL $$\n");
    chmodSync(dies, 0o755);
    const p = project("edge", "edge", ["--import", "tsx"], { node: dies });
    const { report } = await run({ project: p, files: files(p, "test/pass.test.ts") });
    expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(report.failure).toMatch(/edge\/test\/pass\.test\.ts \(signal SIGKILL\)/);
  });

  it("leaves a file whose process died out of a run that completed the others", SLOW, async () => {
    mkdirSync(scratch, { recursive: true });
    const picky = join(scratch, "node-that-dies-on-pass");
    const exec = `exec ${JSON.stringify(process.execPath)} "$@"`;
    writeFileSync(picky, `#!/bin/sh\ncase "$*" in *pass.test.ts*) kill -KILL $$;; esac\n${exec}\n`);
    chmodSync(picky, 0o755);
    const p = project("edge", "edge", ["--import", "tsx"], { node: picky });
    const tier = files(p, "test/pass.test.ts", "test/fail.test.ts");
    const { report } = await run({ project: p, files: tier });
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual(files(p, "test/fail.test.ts"));
    expect(report.results.map((r) => r.check.testPath)).not.toContain("edge/test/pass.test.ts");
    expect(report.failure).toMatch(
      /without a complete report for edge\/test\/pass\.test\.ts \(signal SIGKILL\)/,
    );
  });

  it("is crashed with the reason when the project's Node cannot start", async () => {
    const p = project("edge", "edge", [], { node: join(scratch, "no-such-node") });
    const { report } = await run({ project: p, files: files(p, "test/pass.test.ts") });
    expect(report.end).toBe("crashed");
    expect(report.failure).toMatch(/cannot run .*no-such-node: spawn .* ENOENT/);
  });

  it("passes argv, cwd, env and the preload to the child", SLOW, async () => {
    const dir = join(scratch, "markers");
    mkdirSync(join(dir, "pkg/test"), { recursive: true });
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib/dep.mjs"), 'export const marker = () => "preloaded";\n');
    writeFileSync(
      join(dir, "preload.mjs"),
      'import { marker } from "./lib/dep.mjs";\nglobalThis.squealMarker = marker();\n',
    );
    writeFileSync(join(dir, "pkg/value.ts"), "export const value: number = 1;\n");
    writeFileSync(
      join(dir, "pkg/test/markers.test.ts"),
      [
        'import { basename } from "node:path";',
        'import { test } from "node:test";',
        'import { value } from "../value.ts";',
        'test("cwd " + basename(process.cwd()), () => {});',
        'test("argv " + process.execArgv.includes("--no-deprecation"), () => {});',
        'test("env " + process.env.MARK + " " + process.env.BASE, () => {});',
        'test("preload " + (globalThis as { squealMarker?: string }).squealMarker, () => {});',
        'test("value " + value, () => {});',
        "",
      ].join("\n"),
    );
    const cwd = `.tmp/${scratch.split("/").pop()}/markers/pkg`;
    const p = project(
      "markers",
      cwd,
      ["--import", "../preload.mjs", "--no-deprecation", "--import", "tsx"],
      {
        env: { MARK: "project" },
      },
    );
    const env = { ...process.env, MARK: "daemon", BASE: "daemon", NODE_TEST_CONTEXT: "child-v8" };
    const { report, observed } = await run({
      project: p,
      files: files(p, "test/markers.test.ts"),
      env,
    });
    expect(names(report.results)).toEqual([
      "cwd pkg: pass",
      "argv true: pass",
      "env project daemon: pass",
      "preload preloaded: pass",
      "value 1: pass",
    ]);
    expect(observed).toEqual([
      {
        testFile: { project: "markers", path: `${cwd}/test/markers.test.ts` },
        paths: [`${cwd}/test/markers.test.ts`, `${cwd}/value.ts`],
        preloadPaths: [
          `${cwd.replace(/\/pkg$/, "")}/lib/dep.mjs`,
          `${cwd.replace(/\/pkg$/, "")}/preload.mjs`,
        ],
      },
    ]);
  });

  it(
    "observes the reference closure through the workspace package, preload apart",
    SLOW,
    async () => {
      const demo = project("demo", "reference/packages/demo", [
        "--import",
        "../../scripts/preload.mjs",
        "--import",
        "tsx",
      ]);
      const { observed } = await run({
        project: demo,
        files: files(demo, "test/unit/title.test.ts"),
      });
      expect(observed).toEqual([
        {
          testFile: { project: "demo", path: "reference/packages/demo/test/unit/title.test.ts" },
          paths: [
            "reference/packages/demo/src/title.ts",
            "reference/packages/demo/test/unit/title.test.ts",
            "reference/packages/util/src/index.ts",
          ],
          preloadPaths: ["reference/scripts/lib/marker.mjs", "reference/scripts/preload.mjs"],
        },
      ]);
    },
  );

  it("names the same checks with the same outcomes on a second run", SLOW, async () => {
    const streams = project("streams", "streams", ["--import", "tsx"]);
    const tier = files(streams, "outcomes.test.ts");
    const [first, second] = await Promise.all([
      run({ project: streams, files: tier }),
      run({ project: streams, files: tier }),
    ]);
    expect(names(first.report.results)).toContain("parent: pass");
    expect(names(first.report.results)).toContain("suite > skipped: skip");
    expect(names(first.report.results)).toContain("same (line 32): pass");
    expect(names(second.report.results)).toEqual(names(first.report.results));
  });

  it("reports an empty tier as completed without starting anything", async () => {
    const { report } = await run({ project: edge, files: [] });
    expect(report).toMatchObject({ end: "completed", completedFiles: [], results: [] });
  });
});
