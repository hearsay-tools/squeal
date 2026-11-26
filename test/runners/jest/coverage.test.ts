import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { mapHere } from "../../../src/core/code/coverage/mapper.js";
import { decodeRecord, hasLine } from "../../../src/core/code/coverage/record.js";
import type {
  CoverageRecord,
  CoverageRun,
  CoveredFile,
  RunnerCoverageOptions,
} from "../../../src/core/code/coverage/types.js";
import { squealVersion } from "../../../src/core/daemon/version.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import { createHostedJest } from "../../../src/core/runner-host/process-host.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { JestProject } from "../../../src/core/types/policy-jest.js";
import type { RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { createJestAdapter } from "../../../src/runners/jest/index.js";
import { installJest, JEST_MAJORS, type JestMajor } from "../../helpers/jest-env.js";
import { sourceHost } from "../../runner-host/process-helpers.js";

/*
 * Spec 028 D5.3, spec 015 D8 (row 028-06b) on real Jest 29.7.0 and 30.5.2:
 * the adapter's V8 coverage. Off, its runs take none and its key is as
 * before; on, each completed file's payload and Jest's transforms map
 * through Squeal's own mapper to the source's lines and functions, through
 * a transformer's source map too, and nothing reaches the worktree.
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

/**
 * Two lines before each `.shifted.js` file, with a source map back to it,
 * as a TypeScript transform moves code; other files as they are, no map.
 */
const SHIFT = lines(
  'const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";',
  "const vlq = (n) => {",
  "  let v = n < 0 ? (-n << 1) | 1 : n << 1;",
  '  let out = "";',
  "  do {",
  "    let digit = v & 31;",
  "    v >>>= 5;",
  "    if (v > 0) digit |= 32;",
  "    out += B64[digit];",
  "  } while (v > 0);",
  "  return out;",
  "};",
  "module.exports = {",
  "  process(sourceText, sourcePath) {",
  '    if (!sourcePath.endsWith(".shifted.js")) return { code: sourceText };',
  "    let line = 0;",
  "    let column = 0;",
  '    const segments = sourceText.split("\\n").map((text, i) => {',
  "      const at = text.search(/\\S/);",
  '      if (at === -1) return "";',
  "      const segment = vlq(at) + vlq(0) + vlq(i - line) + vlq(at - column);",
  "      line = i;",
  "      column = at;",
  "      return segment;",
  "    });",
  "    return {",
  '      code: "const shifted = 1;\\nvoid shifted;\\n" + sourceText,',
  '      map: { version: 3, sources: [sourcePath], names: [], mappings: ";;" + segments.join(";"), sourcesContent: [sourceText] },',
  "    };",
  "  },",
  "};",
);

const CALC = lines(
  "exports.used = function used(x) {",
  "  if (x < 0) {",
  "    return 0;",
  "  }",
  "  return x * 2;",
  "};",
  "exports.unused = function unused() {",
  '  return "no";',
  "};",
);

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "app", "private": true }\n`,
  "jest.config.js": lines(
    "module.exports = {",
    '  testEnvironment: "node",',
    '  testMatch: ["<rootDir>/test/**/*.test.js"],',
    '  transform: { "\\\\.js$": "<rootDir>/transform/shift.js" },',
    "  coverageThreshold: { global: { lines: 100 } },",
    "};",
  ),
  "transform/shift.js": SHIFT,
  "src/calc.shifted.js": CALC,
  "src/plain.js": "exports.half = (x) => x / 2;\n",
  "test/calc.test.js": lines(
    'const { used } = require("../src/calc.shifted.js");',
    'test("doubles", () => expect(used(2)).toBe(4));',
  ),
  "test/plain.test.js": lines(
    'const { half } = require("../src/plain.js");',
    'test("halves", () => expect(half(4)).toBe(2));',
  ),
};

const CALC_TEST = ref("test/calc.test.js");
const PLAIN_TEST = ref("test/plain.test.js");
const SLOW = { timeout: 240_000 };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-coverage-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function ref(path: string): TestFileRef {
  return { project: "app", path };
}

function worktree(major: JestMajor, extra: Record<string, string> = {}): AbsolutePath {
  const root = join(scratch, `tree-${made++}`);
  for (const [path, text] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  symlinkSync(
    realpathSync(join(installJest(major), "node_modules/jest")),
    join(root, "node_modules/jest"),
  );
  return root as AbsolutePath;
}

/** Coverage options whose `enabled` is `on()`, keeping each collected run. */
function collecting(on: () => boolean): RunnerCoverageOptions & { runs: CoverageRun[] } {
  const runs: CoverageRun[] = [];
  return { enabled: on, collected: (run) => runs.push(run), runs };
}

function run(
  adapter: RunnerAdapter,
  root: string,
  files: readonly TestFileRef[],
  extra: { stop?: AbortSignal } = {},
): Promise<RunReport> {
  return adapter.run(files, {
    runId: `run-${made}`,
    logDir: join(root, "..", `logs-${made++}`) as AbsolutePath,
    timeoutMs: 120_000,
    ...extra,
  });
}

/** Every file under `dir`, relative; `[]` when there is none. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort();
}

function record(file: CoveredFile): CoverageRecord {
  return decodeRecord(mapHere(file, "sha1", new Map(), () => false));
}

/** The 1-based lines a record's bitset holds. */
function linesOf(bits: string): number[] {
  return Array.from({ length: 16 }, (_, i) => i + 1).filter((line) => hasLine(bits, line - 1));
}

describe.each(JEST_MAJORS)("Jest %i coverage (spec 028 D5.3)", (major) => {
  it("takes none and keys as before while coverage is off", SLOW, async () => {
    const root = worktree(major);
    const plain = await createJestAdapter(PROJECT, { root });
    const coverage = collecting(() => false);
    const off = await createJestAdapter(PROJECT, { root, coverage });
    expect(await off.environment()).toEqual(await plain.environment());

    const logDir = join(scratch, `logs-off-${made++}`) as AbsolutePath;
    const report = await off.run([CALC_TEST, PLAIN_TEST], {
      runId: "off",
      logDir,
      timeoutMs: 120_000,
    });
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toHaveLength(2);
    expect(coverage.runs).toEqual([]);
    expect(filesUnder(logDir).filter((f) => f.includes("/cov/"))).toEqual([]);
    expect(readFileSync(join(logDir, "jest/app/run.json"), "utf8")).not.toContain("--coverage");
    expect(existsSync(join(root, "coverage"))).toBe(false);
  });

  it("maps each completed file's coverage through Jest's transform", SLOW, async () => {
    const root = worktree(major);
    const coverage = collecting(() => true);
    const adapter = await createJestAdapter(PROJECT, { root, coverage });
    const [environment] = await adapter.environment();
    expect(environment?.resolvedConfig).toContain('"coverage":{"provider":"squeal","version":');

    const report = await run(adapter, root, [CALC_TEST, PLAIN_TEST]);
    // The project's `coverageThreshold` fails no batch: Squeal's arguments empty it.
    expect(report.end).toBe("completed");
    expect(report.failure).toBeNull();
    expect(report.results.map((r) => [r.check.fullName, r.outcome]).sort()).toEqual([
      ["doubles", "pass"],
      ["halves", "pass"],
    ]);
    expect(coverage.runs).toHaveLength(1);
    const files = coverage.runs[0]?.files ?? [];
    expect(files.map((f) => f.testFile.path).sort()).toEqual([CALC_TEST.path, PLAIN_TEST.path]);

    const calc = files.find((f) => f.testFile.path === CALC_TEST.path) as CoveredFile;
    const calcPath = join(root, "src/calc.shifted.js") as AbsolutePath;
    expect(calc.sources.get(calcPath)?.map).not.toBeNull();
    const [source, ...others] = record(calc).sources;
    expect(others).toEqual([]);
    expect(source?.path).toBe("src/calc.shifted.js");
    expect(source?.blob).toBe(blobHash(readFileSync(calcPath), "sha1"));
    // The two lines the transform added map nowhere: each line is the source's own.
    expect(linesOf(source?.lines ?? "")).toEqual([1, 2, 3, 5, 7, 8]);
    expect(linesOf(source?.covered ?? "")).toEqual([1, 2, 5, 7]);
    expect(source?.functions.map((f) => [f[0], f[4]])).toEqual([
      [1, 1],
      [7, 0],
    ]);

    const plain = files.find((f) => f.testFile.path === PLAIN_TEST.path) as CoveredFile;
    const plainRecord = record(plain);
    expect(plainRecord.sources.map((s) => [s.path, linesOf(s.covered)])).toEqual([
      ["src/plain.js", [1]],
    ]);
    expect(plainRecord.unread).toEqual([]);

    // No report of Jest's own: nothing in the worktree, no `coverage/` folder.
    expect(existsSync(join(root, "coverage"))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(
      ["jest.config.js", "node_modules", "package.json", "src", "test", "transform"].sort(),
    );
  });

  it("re-keys once when the policy turns coverage on or off", SLOW, async () => {
    const root = worktree(major);
    let on = false;
    const adapter = await createJestAdapter(PROJECT, { root, coverage: collecting(() => on) });
    const [before] = await adapter.environment();
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
    on = true;
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["app"] });
    const [after] = await adapter.environment();
    expect(after?.resolvedConfig).not.toBe(before?.resolvedConfig);
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: [] });
    on = false;
    expect(await adapter.invalidate([])).toEqual({ recreatedProjects: ["app"] });
    const [again] = await adapter.environment();
    expect(again?.resolvedConfig).toBe(before?.resolvedConfig);
  });

  it("runs a file whose closure imports node:inspector without coverage, noted", SLOW, async () => {
    const root = worktree(major, {
      "test/inspector.test.js": lines(
        'const { Session } = require("node:inspector");',
        'const { half } = require("../src/plain.js");',
        'test("opens", () => { new Session(); expect(half(2)).toBe(1); });',
      ),
    });
    const notes: string[] = [];
    const coverage = collecting(() => true);
    const adapter = await createJestAdapter(PROJECT, {
      root,
      coverage,
      note: (text) => notes.push(text),
    });
    await adapter.environment();
    const inspector = ref("test/inspector.test.js");
    const report = await run(adapter, root, [inspector, PLAIN_TEST]);
    expect(report.completedFiles.map((f) => f.path).sort()).toEqual([
      inspector.path,
      PLAIN_TEST.path,
    ]);
    expect(coverage.runs[0]?.files.map((f) => f.testFile.path)).toEqual([PLAIN_TEST.path]);
    expect(notes.filter((n) => n.includes("node:inspector"))).toHaveLength(1);
  });

  it("keeps a completed file's coverage on a stop and drops the cut file's", SLOW, async () => {
    // Jest runs the larger file first when it has no timings, so the padded file completes first.
    const root = worktree(major, {
      "test/done.test.js": lines(
        'const { half } = require("../src/plain.js");',
        'test("done", () => expect(half(2)).toBe(1));',
        "// pad\n".repeat(400),
      ),
      "test/hang.test.js": lines(
        'const { used } = require("../src/calc.shifted.js");',
        'test("hang", () => { used(1); require("fs").writeFileSync(require("path").join(__dirname, "../hang.mark"), "x"); return new Promise(() => {}); }, 600000);',
      ),
    });
    const coverage = collecting(() => true);
    const adapter = await createJestAdapter(PROJECT, { root, coverage });
    await adapter.environment();
    const stop = new AbortController();
    const poll = setInterval(() => existsSync(join(root, "hang.mark")) && stop.abort(), 50);
    const logDir = join(scratch, `logs-stop-${made++}`) as AbsolutePath;
    const report = await adapter
      .run([ref("test/done.test.js"), ref("test/hang.test.js")], {
        runId: "stop",
        logDir,
        timeoutMs: 120_000,
        stop: stop.signal,
      })
      .finally(() => clearInterval(poll));
    expect(report.completedFiles.map((f) => f.path)).toEqual(["test/done.test.js"]);
    const files = coverage.runs[0]?.files ?? [];
    expect(files.map((f) => f.testFile.path)).toEqual(["test/done.test.js"]);
    // Only the completed file's two files are left, for the records' writer.
    const left = filesUnder(join(logDir, "jest/app/cov"));
    expect(left).toEqual(["0/0.json"]);
    expect(files[0]?.payload).toBe(join(logDir, "jest/app/cov/0/0.json"));
    expect(record(files[0] as CoveredFile).sources.map((s) => s.path)).toEqual(["src/plain.js"]);
  });

  it("collects coverage the same from a runner host", SLOW, async () => {
    const root = worktree(major);
    const coverage = collecting(() => true);
    const hosted = await createHostedJest(sourceHost(squealVersion()), PROJECT, { root, coverage });
    onTestFinished(() => hosted.close());
    const here = await createJestAdapter(PROJECT, { root, coverage: collecting(() => true) });
    expect(await hosted.environment()).toEqual(await here.environment());
    const report = await run(hosted, root, [CALC_TEST]);
    expect(report.end).toBe("completed");
    const files = coverage.runs[0]?.files ?? [];
    expect(files.map((f) => f.testFile.path)).toEqual([CALC_TEST.path]);
    const [source] = record(files[0] as CoveredFile).sources;
    expect(linesOf(source?.covered ?? "")).toEqual([1, 2, 5, 7]);
  });
});
