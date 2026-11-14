import { describe, expect, it } from "vitest";
import type { LoadedList, RunReport } from "../../../src/core/types/runner.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 022 D1 (row 022-03): the recorder's cases, each a test file run by
 * the adapter with Squeal's provider on Vitest 5 (the cases of
 * `research/probes/loaded-modules/vitest/`).
 */

const FILES: Readonly<Record<string, string>> = {
  "data/a.txt": "raw text\n",
  // `vi.resetModules()` clears each node's `evaluated` flag and keeps the node.
  "test/reset.test.ts": [
    'import { expect, test, vi } from "vitest";',
    'import { add } from "../src/math.js";',
    'test("resets", () => {',
    "  vi.resetModules();",
    "  expect(add(1, 2)).toBe(3);",
    "});",
    "",
  ].join("\n"),
  // An automock is a `mock:` id. A factory mock never evaluates the module, yet its id
  // is a node of the runner's map on Vitest 5.0.3, so it is in the list: a list may
  // hold more than ran, never less.
  "test/mocks.test.ts": [
    'import { expect, test, vi } from "vitest";',
    'import { add } from "../src/math.js";',
    'import { pad } from "../src/text.js";',
    'vi.mock("../src/math.js");',
    'vi.mock("../src/text.js", () => ({ pad: () => "padded" }));',
    'test("mocks", () => {',
    "  expect(vi.isMockFunction(add)).toBe(true);",
    '  expect(pad("a", 2)).toBe("padded");',
    "});",
    "",
  ].join("\n"),
  "test/raw.test.ts": [
    'import { expect, test } from "vitest";',
    'import text from "../data/a.txt?raw";',
    'test("reads raw", () => {',
    '  expect(text).toBe("raw text\\n");',
    "});",
    "",
  ].join("\n"),
  "test/broken.test.ts": [
    'import { test } from "vitest";',
    'import "../src/missing.js";',
    'test("never runs", () => {});',
    "",
  ].join("\n"),
};

const RUN = ["test/broken.test.ts", "test/mocks.test.ts", "test/raw.test.ts", "test/reset.test.ts"];

const listOf = (report: RunReport, path: string): LoadedList | undefined =>
  report.loaded?.find((l) => l.testFile.path === path);

describe("the loaded list of a Vitest test file (spec 022 D1)", SLOW, () => {
  it("holds every module the worker loaded, evaluated or not, mocked or raw, and none for a failed load", async () => {
    const opened = covering();
    const fx = await openFixture("own-provider", FILES, opened.create);
    const report = await fx.adapter.run(
      RUN.map((f) => ref(f)),
      fx.runOptions(),
    );

    // A failed load ends its file with a file-level error, as Vitest reports it.
    expect(report.completedFiles.map((f) => f.path).sort()).toEqual(RUN);
    expect(listOf(report, "test/reset.test.ts")?.paths).toEqual([
      "src/math.ts",
      "test/reset.test.ts",
    ]);
    expect(listOf(report, "test/mocks.test.ts")?.paths).toEqual([
      "src/math.ts",
      "src/text.ts",
      "test/mocks.test.ts",
    ]);
    expect(listOf(report, "test/raw.test.ts")?.paths).toEqual(["data/a.txt", "test/raw.test.ts"]);
    // It failed to load: no list, so nothing joins its key from this run.
    expect(listOf(report, "test/broken.test.ts")).toBeUndefined();
    // Without observation no list joins a key.
    expect(report.observed).toBeUndefined();
  });

  it("records no list with isolate off, as no coverage", async () => {
    const opened = covering();
    const fx = await openFixture(
      "own-provider",
      {
        "vitest.config.ts": [
          'import { defineConfig } from "vitest/config";',
          'export default defineConfig({ test: { include: ["test/**/*.test.ts"], isolate: false } });',
          "",
        ].join("\n"),
        "test/reset.test.ts": FILES["test/reset.test.ts"] ?? "",
      },
      opened.create,
    );
    const report = await fx.adapter.run([ref("test/reset.test.ts")], fx.runOptions());

    expect(report.completedFiles).toEqual([ref("test/reset.test.ts")]);
    expect(report.loaded).toBeUndefined();
  });
});
