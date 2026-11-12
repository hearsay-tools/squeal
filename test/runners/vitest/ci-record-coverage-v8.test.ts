import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, partRecord } from "../../../src/core/ci/parts.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../../../src/core/code/coverage/record.js";
import { committed, scratch, VITEST } from "../../ci/fixture.js";
import { MATH_FILES, recordCovered } from "./ci-coverage-kit.js";

/*
 * Spec 020 D19.1 (row 020-26ab): with the project's V8 coverage on,
 * `squeal ci record` adds no provider. It reads the payloads of the
 * project's own `@vitest/coverage-v8`, so one run gives the project's
 * report, threshold and exit code as without Squeal, and Squeal's records,
 * equal to the records its own provider gives (`research/ci-coverage-both.md`
 * Q1). `PROJECT_COVERAGE=0` turns the project's coverage off, for the run
 * with Squeal's provider; `CHILDREN=1` turns on its child-process coverage.
 */

const SLOW = { timeout: 300_000 } as const;

/** `MATH_FILES` with the project's V8 coverage on, a JSON report and a lines threshold it fails. */
const V8_FILES: Readonly<Record<string, string>> = {
  ...MATH_FILES,
  "vitest.config.ts": [
    'import { defineConfig } from "vitest/config";',
    "export default defineConfig({",
    "  test: {",
    '    include: ["test/**/*.test.ts"],',
    "    coverage: {",
    '      enabled: process.env.PROJECT_COVERAGE !== "0",',
    '      provider: "v8",',
    '      autoAttachSubprocess: process.env.CHILDREN === "1",',
    '      reporter: ["json"],',
    '      include: ["src/**"],',
    "      thresholds: { lines: 95 },",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n"),
  "src/untested.ts": "export function untested(x: number): number {\n  return x > 1 ? x : 0;\n}\n",
};

/** A test file that runs a project file in a child process. */
const CHILD_FILES = {
  "src/child.mjs": "console.log(2 * 3);\n",
  "test/child.test.ts": [
    'import { spawnSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    'import { expect, it } from "vitest";',
    'const child = fileURLToPath(new URL("../src/child.mjs", import.meta.url));',
    'it("runs a child", () => expect(spawnSync(process.execPath, [child]).stdout.toString()).toBe("6\\n"));',
    "",
  ].join("\n"),
};

const reasons = (part: Part | undefined) =>
  part?.testFiles.map((f) => [f.path, f.record === undefined ? null : "record", f.noRecord]);

const records = (part: Part | undefined) =>
  part?.testFiles.map((file) => [file.path, file.noRecord, partRecord(part, file)]);

describe("squeal ci record beside the project's V8 coverage (spec 020 D19)", () => {
  it(
    "keeps the project's report and exit code, and records as Squeal's provider does",
    SLOW,
    async () => {
      const root = committed(scratch("ci-coverage-v8"), V8_FILES);
      const report = join(root, "coverage/coverage-final.json");
      const plain = spawnSync(process.execPath, [VITEST, "run"], { cwd: root, encoding: "utf8" });
      expect(plain.status, plain.stderr).toBe(1);
      expect(plain.stderr).toContain("does not meet global threshold");
      const plainReport: unknown = JSON.parse(readFileSync(report, "utf8"));

      const env = { ...process.env, PROJECT_COVERAGE: "0" };
      const own = await recordCovered(root, join(dirname(root), "own"), [], undefined, env);
      expect(own.code, own.said).toBe(0);
      expect(own.parts[0]?.header.coverage).toMatchObject({ collector: "squeal" });

      const run = await recordCovered(root, join(dirname(root), "v8"));
      expect(run.code, run.said).toBe(1);
      expect(JSON.parse(readFileSync(report, "utf8"))).toEqual(plainReport);
      const part = run.parts[0] as Part;
      expect(part.header.coverage).toEqual({
        provider: "squeal",
        collector: "v8",
        collectorVersion: "5.0.3",
        providerVersion: COVERAGE_PROVIDER_VERSION,
        recordVersion: COVERAGE_RECORD_VERSION,
      });
      expect(records(part)).toEqual(records(own.parts[0]));
      expect(part.testFiles.every((f) => f.record !== undefined)).toBe(true);
      expect(run.said).toContain("coverage records for 2 of 2 test files");
    },
  );

  it("gives a project run with isolate: false no record, and keeps its report", SLOW, async () => {
    const root = committed(scratch("ci-coverage-v8-isolate"), V8_FILES);
    const run = await recordCovered(root, join(dirname(root), "parts"), ["--no-isolate"]);
    expect(run.code, run.said).toBe(1);
    expect(run.parts[0]?.header.coverage).toMatchObject({ collector: "v8" });
    expect(reasons(run.parts[0])).toEqual([
      ["test/add.test.ts", null, "isolate-false"],
      ["test/grade.test.ts", null, "isolate-false"],
    ]);
    const report = JSON.parse(readFileSync(join(root, "coverage/coverage-final.json"), "utf8"));
    expect(Object.keys(report).map((file) => file.slice(root.length + 1))).toContain("src/math.ts");
  });

  it("gives a file whose payload holds a child process's scripts no record", SLOW, async () => {
    const root = committed(scratch("ci-coverage-v8-child"), { ...V8_FILES, ...CHILD_FILES });
    const env = { ...process.env, CHILDREN: "1" };
    const run = await recordCovered(root, join(dirname(root), "parts"), [], undefined, env);
    expect(run.code, run.said).toBe(1);
    expect(reasons(run.parts[0])).toEqual([
      ["test/add.test.ts", "record", undefined],
      ["test/child.test.ts", null, "child-process"],
      ["test/grade.test.ts", "record", undefined],
    ]);
  });
});
