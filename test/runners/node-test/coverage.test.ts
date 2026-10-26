import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import {
  type CoverageRecord,
  type CoverageRun,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import { mapHere } from "../../../src/core/code/coverage/mapper.js";
import { joinCoverage } from "../../../src/core/code/crap/join.js";
import { blobHash } from "../../../src/core/hash/index.js";
import type { NodeTestProject, RunnerAdapter } from "../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/*
 * Spec 015 D8 (row 015-86): coverage from Squeal's own node:test runs, on a
 * tsx project under the fixtures' git-ignored `.tmp/`, so tsx resolves from
 * the repository's `node_modules`. Each completed file's own process gives
 * one V8 file; a process the test spawns gives none, and a test file whose
 * closure imports `node:inspector` runs without coverage.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-coverage-"));
let root = "";

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const SHAPES = lines(
  "export function area(w: number, h: number): number {",
  "  if (w < 0) {",
  "    return 0;",
  "  }",
  "  return w * h;",
  "}",
  "",
  "export function neverCalled(): string {",
  '  return "no";',
  "}",
);
const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "covered", type: "module" })}\n`,
  "src/shapes.ts": SHAPES,
  "src/child-only.ts": lines("export function childOnly(): number {", "  return 2;", "}"),
  "src/child-main.ts": lines(
    'import { childOnly } from "./child-only.ts";',
    'process.stdout.write(childOnly() + ":" + (process.env.NODE_V8_COVERAGE ?? "unset"));',
  ),
  "test/shapes.test.ts": lines(
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { test } from "node:test";',
    'import { area } from "../src/shapes.ts";',
    "",
    'test("area", () => assert.equal(area(2, 3), 6));',
    'test("sees no coverage variable", () => {',
    "  assert.equal(process.env.NODE_V8_COVERAGE, undefined);",
    "  assert.equal(process.env.SQUEAL_NODE_TEST_COVERAGE, undefined);",
    "});",
    'test("runs a child that writes no coverage", () => {',
    '  const child = spawnSync(process.execPath, ["--import", "tsx", "src/child-main.ts"], {',
    '    encoding: "utf8",',
    "  });",
    '  assert.equal(child.stdout, "2:unset", child.stderr);',
    "});",
  ),
  "test/inspector.test.ts": lines(
    'import { Session } from "node:inspector";',
    'import { test } from "node:test";',
    'import { area } from "../src/shapes.ts";',
    "",
    'test("can open a session", () => {',
    "  new Session();",
    "  area(1, 1);",
    "});",
  ),
};

beforeAll(() => {
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(scratch, "repo", path)), { recursive: true });
    writeFileSync(join(scratch, "repo", path), text);
  }
  root = realpathSync(join(scratch, "repo"));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const PROJECT: NodeTestProject = {
  name: "unit",
  argv: ["--import", "tsx"],
  env: {},
  include: ["test/*.test.ts"],
};
const ref = (path: string) => ({ project: PROJECT.name, path });

/** An adapter over the fixture, coverage on while `on.value`; its notes and handed-over runs. */
async function covering(on = { value: true }, project = PROJECT) {
  const runs: CoverageRun[] = [];
  const notes: string[] = [];
  const adapter = await createNodeTestAdapter(project, {
    root,
    note: (text) => notes.push(text),
    tempDir: join(logs, "tmp"),
    coverage: { enabled: () => on.value, collected: (run) => runs.push(run) },
  });
  return { adapter, runs, notes };
}

async function run(adapter: RunnerAdapter, paths: readonly string[]) {
  await adapter.environment();
  const logDir = join(logs, randomUUID());
  const report = await adapter.run(paths.map(ref), { runId: "r1", logDir, timeoutMs: 60_000 });
  return { report, logDir };
}

const recordOf = (run: CoverageRun | undefined, path: string): CoverageRecord => {
  const file = run?.files.find((f) => f.testFile.path === path);
  if (file === undefined) throw new Error(`no payload for ${path}`);
  return decodeRecord(mapHere(file, "sha1", new Map(), () => false));
};

describe("coverage from node:test runs (row 015-86)", () => {
  it("reads a function a test calls covered, and one never called untested", SLOW, async () => {
    const { adapter, runs } = await covering();
    const { report } = await run(adapter, ["test/shapes.test.ts"]);
    await adapter.close();
    expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
      "area: pass",
      "sees no coverage variable: pass",
      "runs a child that writes no coverage: pass",
    ]);
    expect(runs.map((r) => r.files.map((f) => [f.testFile.path, f.ownRoot]))).toEqual([
      [["test/shapes.test.ts", root]],
    ]);
    const record = recordOf(runs[0], "test/shapes.test.ts");
    const shapes = record.sources.find((s) => s.path === "src/shapes.ts");
    expect(shapes?.blob).toBe(blobHash(Buffer.from(SHAPES), "sha1"));
    const { functions } = await countFile(SHAPES, "typescript");
    const joined = joinCoverage(functions, shapes === undefined ? [] : [shapes]);
    // `area`'s early return (line 3) did not run.
    const states = functions.map((f, i) => [
      f.qualifiedName,
      joined[i]?.ran,
      joined[i]?.covered,
      joined[i]?.lines,
    ]);
    expect(states).toEqual([
      ["area", true, 3, 4],
      ["neverCalled", false, 0, 2],
    ]);
  });

  it("counts no line of a process the test spawns", SLOW, async () => {
    const { adapter, runs } = await covering();
    const { report, logDir } = await run(adapter, ["test/shapes.test.ts"]);
    await adapter.close();
    // The child saw no NODE_V8_COVERAGE, so it wrote none (its test reads "2:unset").
    const child = report.results.find((r) => r.check.fullName.startsWith("runs a child"));
    expect(child?.outcome).toBe("pass");
    // Of the directory only the test file's own payload is left.
    const payload = runs[0]?.files[0]?.payload ?? "";
    expect(readdirSync(join(logDir, "node-test", "unit", "cov-0"))).toEqual([
      payload.split("/").at(-1),
    ]);
    const record = recordOf(runs[0], "test/shapes.test.ts");
    expect(record.sources.map((s) => s.path)).toEqual(["src/shapes.ts", "test/shapes.test.ts"]);
  });

  it(
    "runs a file whose closure imports node:inspector without coverage, with a note",
    SLOW,
    async () => {
      const { adapter, runs, notes } = await covering();
      const { report } = await run(adapter, ["test/inspector.test.ts", "test/shapes.test.ts"]);
      await adapter.close();
      expect(report.completedFiles.map((f) => f.path).sort()).toEqual([
        "test/inspector.test.ts",
        "test/shapes.test.ts",
      ]);
      expect(runs.flatMap((r) => r.files.map((f) => f.testFile.path))).toEqual([
        "test/shapes.test.ts",
      ]);
      expect(notes).toContain(
        'node-test project "unit": coverage is off for test/inspector.test.ts: its closure imports node:inspector, so its tests can see V8 coverage (spec 015 D8)',
      );
    },
  );

  it(
    "keys with Squeal's marker while coverage is on, re-keying once at each change",
    SLOW,
    async () => {
      const on = { value: false };
      const { adapter, runs } = await covering(on);
      const config = async () =>
        JSON.parse((await adapter.environment())[0]?.resolvedConfig ?? "{}");
      const off = await config();
      expect(off).not.toHaveProperty("coverage");
      await run(adapter, ["test/shapes.test.ts"]);
      expect(runs).toEqual([]);
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
      on.value = true;
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["unit"] });
      expect(await config()).toEqual({ ...off, coverage: { provider: "squeal", version: 2 } });
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
      on.value = false;
      expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["unit"] });
      expect(await config()).toEqual(off);
      await adapter.close();
    },
  );

  it("takes none in a project that runs its files in the node --test process", SLOW, async () => {
    const shared = { ...PROJECT, argv: [...PROJECT.argv, "--test-isolation=none"] };
    const { adapter, runs, notes } = await covering({ value: true }, shared);
    const [environment] = await adapter.environment();
    await adapter.close();
    expect(JSON.parse(environment?.resolvedConfig ?? "{}")).not.toHaveProperty("coverage");
    expect(runs).toEqual([]);
    expect(notes).toEqual([
      'node-test project "unit": coverage is off: --test-isolation=none runs its test files in the node --test process, where a process a test spawns would add its coverage (spec 015 D8)',
    ]);
  });
});

describe("a project with coverage off (row 015-86)", () => {
  it("leaves a project's own NODE_V8_COVERAGE to its tests", SLOW, async () => {
    const own = join(logs, "own-coverage");
    const project = { ...PROJECT, env: { NODE_V8_COVERAGE: own } };
    const { adapter, runs } = await covering({ value: false }, project);
    const { report } = await run(adapter, ["test/shapes.test.ts"]);
    await adapter.close();
    expect(runs).toEqual([]);
    const outcome = (name: string) =>
      report.results.find((r) => r.check.fullName === name)?.outcome;
    // The test sees the project's own variable, and its child writes there too, as on 0.1.354.
    expect(outcome("sees no coverage variable")).toBe("fail");
    expect(outcome("runs a child that writes no coverage")).toBe("fail");
    expect(readdirSync(own).length).toBeGreaterThan(0);
  });
});
