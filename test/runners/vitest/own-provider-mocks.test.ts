import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { buildRecord, hasLine } from "../../../src/core/code/coverage/record.js";
import type { CoverageSource, V8Script } from "../../../src/core/code/coverage/types.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 018-10: Vitest's module runner evaluates Squeal's provider again in
 * a worker after a test file ran, with that file's mocks in place. Cezar's
 * `store-windows.test.ts` mocks `node:path` with `path.win32`; a provider
 * that imports `join` from `node:path` then wrote its payload to a
 * `\tmp\...` file in the project root and the file's coverage was lost.
 * Review wave-3.5 B1: a mock of `node:url` alone left a record, mapped
 * without the evaluator's wrapper offset: the wrong lines.
 */

/** One test file per built-in the provider uses, each mocked as a test may mock it. */
const MOCKS: Readonly<Record<string, string>> = {
  "test/win32-path.test.ts": [
    'import path from "node:path";',
    'import { expect, test, vi } from "vitest";',
    'import { add } from "../src/math.js";',
    'vi.mock("node:path", async (importOriginal) => {',
    '  const { win32 } = await importOriginal<typeof import("node:path")>();',
    "  return { ...win32, default: win32 };",
    "});",
    'test("joins as Windows does", () => {',
    '  expect(path.join("/a", "b")).toBe("\\\\a\\\\b");',
    "  expect(add(1, 2)).toBe(3);",
    "});",
    "",
  ].join("\n"),
  "test/stubbed-fs-crypto.test.ts": [
    'import { expect, test, vi } from "vitest";',
    'import { clamp } from "../src/math.js";',
    "const noop = () => undefined;",
    'vi.mock("node:fs", async (importOriginal) => ({',
    "  ...(await importOriginal<object>()),",
    "  mkdirSync: noop,",
    "  readFileSync: noop,",
    "  writeFileSync: noop,",
    "}));",
    'vi.mock("node:crypto", async (importOriginal) => ({',
    "  ...(await importOriginal<object>()),",
    '  randomUUID: () => "mocked",',
    "}));",
    'test("runs with stubbed built-ins", () => {',
    "  expect(clamp(-1, 0, 10)).toBe(0);",
    "});",
    "",
  ].join("\n"),
  "test/mocked-url.test.ts": [
    'import { expect, test, vi } from "vitest";',
    'import { clamp } from "../src/math.js";',
    'vi.mock("node:url", async (importOriginal) => ({',
    "  ...(await importOriginal<object>()),",
    '  fileURLToPath: () => "/mocked",',
    "}));",
    'test("runs with a mocked fileURLToPath", () => {',
    "  expect(clamp(-1, 0, 10)).toBe(0);",
    "});",
    "",
  ].join("\n"),
};

const MOCKED = Object.keys(MOCKS).sort();

/**
 * The lines of the fixture's `src/math.ts` each file ran: `add` or `clamp`'s
 * first `if`, with the module's own statements. A payload mapped without the
 * evaluator's wrapper offset (a mocked `fileURLToPath`) would miss them.
 */
const COVERED: Readonly<Record<string, readonly number[]>> = {
  "test/mocked-url.test.ts": [5, 6, 11, 13],
  "test/stubbed-fs-crypto.test.ts": [5, 6, 11, 13],
  "test/win32-path.test.ts": [1, 2, 11, 13],
};

const covered = (bits: string) =>
  Array.from({ length: 20 }, (_, i) => i + 1).filter((line) => hasLine(bits, line - 1));

/**
 * Review wave-3.5 S1: a provider that joins its payload's path with a
 * mocked `node:path` writes it, relative, in the inner workers' working
 * directory: this process's, the checkout root. Each such entry names the
 * run's own reports directory, so only this test's are listed.
 */
function escaped(tempDir: string): string[] {
  const owned = basename(tempDir);
  return readdirSync(process.cwd()).filter((name) => name.includes(owned));
}

describe("Squeal's provider under a test file's mocks of Node built-ins (row 018-10)", SLOW, () => {
  it("writes each payload in the reports directory and keeps each file's coverage", async () => {
    const opened = covering();
    // After the fixture's adapter closes, on a pass, a failure or a timeout.
    onTestFinished(() => {
      for (const name of escaped(opened.tempDir)) {
        rmSync(join(process.cwd(), name), { recursive: true, force: true });
      }
    });
    const fx = await openFixture("own-provider", MOCKS, opened.create);
    const report = await fx.adapter.run(
      MOCKED.map((f) => ref(f)),
      fx.runOptions({ runId: "r1" }),
    );

    expect(report.failure).toBeNull();
    expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual(
      MOCKED.map((f) => [f, "pass"]),
    );
    // Every payload a worker wrote is in the reports directory, none a relative
    // `\tmp\squeal-...` file in the worker's working directory.
    expect(escaped(opened.tempDir)).toEqual([]);
    const written = opened.payloads();
    expect(written).toHaveLength(MOCKED.length);
    for (const payload of written) expect(payload.startsWith(opened.tempDir)).toBe(true);
    expect(opened.runs.flatMap((r) => r.files.map((f) => f.testFile.path)).sort()).toEqual(MOCKED);
    const maths = new Map<string, CoverageSource>();
    for (const file of opened.runs.flatMap((r) => r.files)) {
      expect(existsSync(file.payload)).toBe(true);
      const { result } = JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] };
      const record = buildRecord(file, result, "sha1", new Map());
      expect(record.sources.map((s) => s.path)).toEqual(["src/math.ts", file.testFile.path]);
      const math = record.sources[0] as CoverageSource;
      expect(covered(math.covered)).toEqual(COVERED[file.testFile.path]);
      maths.set(file.testFile.path, math);
    }
    // The same test body with `node:url` mocked or not: the same lines and function spans.
    expect(maths.get("test/mocked-url.test.ts")).toEqual(
      maths.get("test/stubbed-fs-crypto.test.ts"),
    );
  });
});
