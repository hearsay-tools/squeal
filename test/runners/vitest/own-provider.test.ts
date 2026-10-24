import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRecord,
  COVERAGE_PROVIDER_VERSION,
  type CoverageRun,
  type CoverageSource,
  coverageProvider,
  hasLine,
  type V8Script,
} from "../../../src/core/code/coverage/index.js";
import { blobHash } from "../../../src/core/hash/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 015 D8, goals 9 and 10 (row 015-11): with coverage on, each run the
 * adapter makes leaves one payload per completed test file, through
 * Squeal's own provider, and none for a file whose closure imports
 * `node:inspector`, which still passes.
 */

const provider = coverageProvider() ?? "";
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Opened {
  readonly runs: CoverageRun[];
  readonly notes: string[];
  readonly tempDir: string;
}

function covering(on: () => boolean = () => true): Opened & {
  create: (root: string) => ReturnType<typeof createVitestAdapter>;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "sq-own-provider-"));
  temps.push(tempDir);
  const runs: CoverageRun[] = [];
  const notes: string[] = [];
  return {
    runs,
    notes,
    tempDir,
    create: (root) =>
      createVitestAdapter({
        root,
        note: (text) => notes.push(text),
        coverage: { enabled: on, provider, tempDir, collected: (run) => runs.push(run) },
      }),
  };
}

function payload(path: string): V8Script[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { result: V8Script[] }).result;
}

const lines = (bits: string, count: number) =>
  Array.from({ length: count }, (_, i) => i + 1).filter((line) => hasLine(bits, line - 1));

/**
 * Review 0.1.295 B2's probe: the fixture's inspector import moved into the
 * project's setup file, which no test file's closure holds. Under coverage
 * its test counts 2.
 */
const SETUP_READS_COVERAGE: Readonly<Record<string, string>> = {
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    'export default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] } });',
    "",
  ].join("\n"),
  "test/setup.ts": [
    'import inspector from "node:inspector/promises";',
    "globalThis.probeInspector = inspector;",
    "",
  ].join("\n"),
  "test/self-coverage.test.ts": [
    'import { expect, test } from "vitest";',
    'import { clamp } from "../src/math.js";',
    'test("own precise coverage counts only what ran after it started", async () => {',
    "  clamp(1, 0, 10);",
    "  const session = new globalThis.probeInspector.Session();",
    "  session.connect();",
    '  await session.post("Profiler.enable");',
    '  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });',
    "  clamp(5, 0, 10);",
    '  const { result } = await session.post("Profiler.takePreciseCoverage");',
    '  await session.post("Profiler.stopPreciseCoverage");',
    "  session.disconnect();",
    '  const script = result.find((s) => s.url.endsWith("/src/math.ts"));',
    '  const fn = script?.functions.find((f) => f.functionName === "clamp");',
    "  expect(fn?.ranges[0].count).toBe(1);",
    "});",
    "",
  ].join("\n"),
};

describe("vitest adapter: Squeal's coverage provider", SLOW, () => {
  it("leaves one payload per test file, none for one that reads V8 coverage, which passes", async () => {
    const opened = covering();
    const fx = await openFixture("own-provider", {}, opened.create);
    const files = ["test/math.test.ts", "test/self-coverage.test.ts", "test/text.test.ts"];
    const report = await fx.adapter.run(
      files.map((f) => ref(f)),
      fx.runOptions({ runId: "r1" }),
    );

    expect(report.failure).toBeNull();
    expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
      ["test/math.test.ts", "pass"],
      ["test/math.test.ts", "pass"],
      ["test/self-coverage.test.ts", "pass"],
      ["test/text.test.ts", "pass"],
    ]);
    expect(opened.notes.filter((n) => n.includes("node:inspector"))).toEqual([
      "coverage is off for test/self-coverage.test.ts: its closure imports node:inspector, so its tests can see V8 coverage (spec 015 D8)",
    ]);
    // In the order the files ended.
    expect(opened.runs.map((r) => [r.runId, r.files.map((f) => f.testFile.path).sort()])).toEqual([
      ["r1", ["test/math.test.ts", "test/text.test.ts"]],
    ]);
    // Nothing is written into the worktree; the payloads are in the daemon's temp directory.
    expect(existsSync(join(fx.root, "coverage"))).toBe(false);
    for (const file of opened.runs[0]?.files ?? []) {
      expect(file.payload.startsWith(opened.tempDir)).toBe(true);
    }
  });

  it("takes none in a project whose setup file imports node:inspector, and names each file (review 0.1.295 B2)", async () => {
    const opened = covering();
    const fx = await openFixture("own-provider", SETUP_READS_COVERAGE, opened.create);
    const files = ["test/math.test.ts", "test/self-coverage.test.ts"];
    const report = await fx.adapter.run(
      files.map((f) => ref(f)),
      fx.runOptions(),
    );

    expect(report.failure).toBeNull();
    expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
      ["test/math.test.ts", "pass"],
      ["test/math.test.ts", "pass"],
      ["test/self-coverage.test.ts", "pass"],
    ]);
    expect(opened.notes.filter((n) => n.includes("node:inspector"))).toEqual(
      files.map(
        (f) =>
          `coverage is off for ${f}: its project's setup files import node:inspector, so its tests can see V8 coverage (spec 015 D8)`,
      ),
    );
    expect(opened.runs).toEqual([]);
  });

  it("maps a payload to each source's lines and functions, at the blob the run read", async () => {
    const opened = covering();
    const fx = await openFixture("own-provider", {}, opened.create);
    await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    const [file] = opened.runs[0]?.files ?? [];
    if (file === undefined) throw new Error("no payload");

    const record = buildRecord(file, payload(file.payload), "sha1", new Map());
    const math = record.sources.find((s) => s.path === "src/math.ts") as CoverageSource;
    expect(record.sources.map((s) => s.path)).toEqual(["src/math.ts", "test/math.test.ts"]);
    expect(record.unread).toEqual([]);
    expect(math.blob).toBe(blobHash(readFileSync(join(fx.root, "src/math.ts")), "sha1"));
    // `add` ran; `clamp(-1, 0, 10)` returned at its first `if`; `arrow`, the field and
    // `increment` never ran. A line of closing braces is no code that runs.
    expect(lines(math.covered, 20)).toEqual([1, 2, 5, 6, 11, 13]);
    expect(lines(math.lines, 20)).toEqual([1, 2, 5, 6, 7, 8, 11, 13, 14, 15, 16, 17]);
    // V8 gives the class's field initializer a function of its own (line 14).
    expect(math.functions.map(([line, , , , hit]) => [line, hit])).toEqual([
      [1, 1],
      [5, 1],
      [11, 0],
      [14, 0],
      [15, 0],
    ]);
  });

  it("keys a coverage-on instance by the provider's name and version alone, and coverage off as before", async () => {
    const resolved = async (create?: (root: string) => ReturnType<typeof createVitestAdapter>) => {
      const fx = await openFixture("own-provider", {}, create);
      const [environment] = await fx.adapter.environment();
      return JSON.parse(environment?.resolvedConfig ?? "null") as { coverage: unknown };
    };
    const plain = await resolved();
    const off = await resolved(covering(() => false).create);
    const first = await resolved(covering().create);
    const second = await resolved(covering().create);

    expect(off).toEqual(plain);
    expect(first).toEqual(second);
    expect(first.coverage).toEqual({ provider: "squeal", version: COVERAGE_PROVIDER_VERSION });
    expect({ ...first, coverage: null }).toEqual({ ...plain, coverage: null });
  });
});
