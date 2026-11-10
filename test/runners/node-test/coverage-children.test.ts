import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapHere } from "../../../src/core/code/coverage/mapper.js";
import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../../../src/core/code/coverage/record.js";
import type { CoverageRun } from "../../../src/core/code/coverage/types.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { coverageDir, coveragePayloads } from "../../../src/runners/node-test/run/coverage.js";

/*
 * Spec 020 D12 item 3 (row 020-10a): with `coverage.children`, the recorder
 * points `NODE_V8_COVERAGE` at `children/` in the test file's coverage
 * directory where it deletes it otherwise, so the processes and threads a
 * test starts write there, and the own file is still found. A tsx project
 * under the fixtures' git-ignored `.tmp/`, as `coverage.test.ts`.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/node-test");
const SLOW = { timeout: 60_000 } as const;
const scratch = join(FIXTURES, ".tmp", randomUUID());
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-children-"));
let root = "";

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "children", type: "module" })}\n`,
  "src/shapes.ts": lines(
    "export function area(w: number, h: number): number {",
    "  return w * h;",
    "}",
  ),
  "src/child-only.ts": lines("export function childOnly(): number {", "  return 2;", "}"),
  "src/child-main.ts": lines(
    'import { childOnly } from "./child-only.ts";',
    'process.stdout.write(childOnly() + ":" + (process.env.NODE_V8_COVERAGE ? "set" : "unset"));',
  ),
  "src/thread-only.mjs": lines("export const threadOnly = () => 3;"),
  "src/thread-main.mjs": lines(
    'import { parentPort } from "node:worker_threads";',
    'import { threadOnly } from "./thread-only.mjs";',
    "parentPort.postMessage(threadOnly());",
  ),
  "test/children.test.ts": lines(
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { test } from "node:test";',
    'import { Worker } from "node:worker_threads";',
    'import { area } from "../src/shapes.ts";',
    "",
    'test("area", () => assert.equal(area(2, 3), 6));',
    'test("sees the children directory, and no variable of Squeal\'s own", () => {',
    '  assert.match(process.env.NODE_V8_COVERAGE ?? "", /\\/children$/);',
    "  assert.equal(process.env.SQUEAL_NODE_TEST_COVERAGE, undefined);",
    "  assert.equal(process.env.SQUEAL_NODE_TEST_CHILDREN, undefined);",
    "});",
    'test("runs a tsx child", () => {',
    '  const child = spawnSync(process.execPath, ["--import", "tsx", "src/child-main.ts"], {',
    '    encoding: "utf8",',
    "  });",
    '  assert.equal(child.stdout, "2:set", child.stderr);',
    "});",
    'test("starts a thread", async () => {',
    '  const worker = new Worker(new URL("../src/thread-main.mjs", import.meta.url));',
    '  assert.equal(await new Promise((done, fail) => worker.once("message", done).once("error", fail)), 3);',
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

async function covering(children: { value: boolean }) {
  const runs: CoverageRun[] = [];
  const adapter = await createNodeTestAdapter(PROJECT, {
    root,
    note: () => {},
    tempDir: join(logs, "tmp"),
    coverage: {
      enabled: () => true,
      children: () => children.value,
      collected: (run) => runs.push(run),
    },
  });
  return { adapter, runs };
}

async function run(adapter: RunnerAdapter) {
  await adapter.environment();
  const logDir = join(logs, randomUUID());
  const report = await adapter.run([ref("test/children.test.ts")], {
    runId: "r1",
    logDir,
    timeoutMs: 60_000,
  });
  return { report, logDir };
}

describe("node:test children's coverage (020 D12)", () => {
  it(
    "keeps the own file, collects the children and a thread under children/, and maps them in",
    SLOW,
    async () => {
      const { adapter, runs } = await covering({ value: true });
      const { report, logDir } = await run(adapter);
      await adapter.close();
      expect(report.results.map((r) => `${r.check.fullName}: ${r.outcome}`)).toEqual([
        "area: pass",
        "sees the children directory, and no variable of Squeal's own: pass",
        "runs a tsx child: pass",
        "starts a thread: pass",
      ]);
      const dir = join(logDir, "node-test", "unit", "cov-0");
      const [file] = runs[0]?.files ?? [];
      // The own file is still the one main-thread file of the named pid, in the file's directory.
      expect(file?.payload).toMatch(/\/cov-0\/coverage-\d+-\d+-0\.json$/);
      expect(file?.children).toEqual({ root, dir: join(dir, "children") });
      expect(readdirSync(dir).sort()).toEqual(["children", file?.payload.split("/").at(-1)]);
      // The tsx child's main thread, and the test's own thread (not thread 0).
      const written = readdirSync(join(dir, "children"));
      expect(written.filter((n) => /^coverage-\d+-\d+-0\.json$/.test(n)).length).toBeGreaterThan(0);
      expect(written.some((n) => /^coverage-\d+-\d+-[1-9]\d*\.json$/.test(n))).toBe(true);

      if (file === undefined) throw new Error("no payload");
      const record = decodeRecord(mapHere(file, "sha1", new Map(), () => false));
      expect(record.sources.map((s) => s.path)).toEqual([
        "src/child-main.ts",
        "src/child-only.ts",
        "src/shapes.ts",
        "src/thread-main.mjs",
        "src/thread-only.mjs",
        "test/children.test.ts",
      ]);
      expect(record.unread).toEqual([]);
      expect(existsSync(join(dir, "children"))).toBe(false);
    },
  );

  it("names the children in the key's marker only while they are measured", SLOW, async () => {
    const children = { value: true };
    const { adapter } = await covering(children);
    const config = async () => {
      const [environment] = await adapter.environment();
      return JSON.parse(environment?.resolvedConfig ?? "{}") as { coverage?: unknown };
    };
    const on = await config();
    children.value = false;
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["unit"] });
    const off = await config();
    await adapter.close();
    expect(on.coverage).toEqual({
      provider: "squeal",
      version: COVERAGE_PROVIDER_VERSION,
      children: true,
    });
    expect(off.coverage).toEqual({ provider: "squeal", version: COVERAGE_PROVIDER_VERSION });
    expect({ ...on, coverage: null }).toEqual({ ...off, coverage: null });
  });
});

describe("coveragePayloads with children (020 D12)", () => {
  it("returns a completed file's own payload with its children directory, and deletes the rest", () => {
    const logDir = mkdtempSync(join(logs, "payloads-"));
    const file = (i: number, name: string) => {
      mkdirSync(dirname(join(coverageDir(logDir, i), name)), { recursive: true });
      writeFileSync(join(coverageDir(logDir, i), name), "{}");
    };
    for (const i of [0, 1]) {
      file(i, "own-41");
      file(i, "coverage-41-1-0.json");
      file(i, "coverage-41-1-1.json");
      file(i, "children/coverage-42-1-0.json");
    }
    const [done, cut] = [ref("test/a.test.ts"), ref("test/b.test.ts")];

    expect(coveragePayloads(logDir, [done, cut], [done])).toEqual([
      {
        testFile: done,
        payload: join(coverageDir(logDir, 0), "coverage-41-1-0.json"),
        children: join(coverageDir(logDir, 0), "children"),
      },
    ]);
    expect(readdirSync(coverageDir(logDir, 0)).sort()).toEqual([
      "children",
      "coverage-41-1-0.json",
    ]);
    // A file that did not complete keeps nothing, its children's directory included.
    expect(readdirSync(coverageDir(logDir, 1))).toEqual([]);
  });
});
