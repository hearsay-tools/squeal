import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  "test/stubbed-builtins.test.ts": [
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
    'vi.mock("node:url", async (importOriginal) => ({',
    "  ...(await importOriginal<object>()),",
    '  fileURLToPath: () => "/mocked",',
    "}));",
    'test("runs with stubbed built-ins", () => {',
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
  "test/stubbed-builtins.test.ts": [5, 6, 11, 13],
  "test/win32-path.test.ts": [1, 2, 11, 13],
};

const covered = (bits: string) =>
  Array.from({ length: 20 }, (_, i) => i + 1).filter((line) => hasLine(bits, line - 1));

describe("Squeal's provider under a test file's mocks of Node built-ins (row 018-10)", SLOW, () => {
  it("writes each payload in the reports directory and keeps each file's coverage", async () => {
    const opened = covering();
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
    const written = opened.payloads();
    expect(written).toHaveLength(MOCKED.length);
    for (const payload of written) expect(payload.startsWith(opened.tempDir)).toBe(true);
    expect(opened.runs.flatMap((r) => r.files.map((f) => f.testFile.path)).sort()).toEqual(MOCKED);
    for (const file of opened.runs.flatMap((r) => r.files)) {
      expect(existsSync(file.payload)).toBe(true);
      const { result } = JSON.parse(readFileSync(file.payload, "utf8")) as { result: V8Script[] };
      const record = buildRecord(file, result, "sha1", new Map());
      expect(record.sources.map((s) => s.path)).toEqual(["src/math.ts", file.testFile.path]);
      const math = record.sources[0] as CoverageSource;
      expect(covered(math.covered)).toEqual(COVERED[file.testFile.path]);
    }
  });
});
