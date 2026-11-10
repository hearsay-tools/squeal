import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, partRecord } from "../../../src/core/ci/parts.js";
import { committed, scratch } from "../../ci/fixture.js";
import { MATH_FILES, recordCovered } from "./ci-coverage-kit.js";

/*
 * Spec 020 D13.1 (row 020-08a): with the provider in the run, a test file
 * gets no record when a test name filter ran part of it, when its project
 * runs with `isolate: false`, or when a module its worker ran imports
 * `node:inspector`; the part says why. Spec 015 D8 keeps records only for
 * a file run whole, and its Fidelity rule leaves out a test that can see
 * V8 coverage.
 */

const SLOW = { timeout: 300_000 } as const;

/** A source that imports the inspector, and a test file that loads it. */
const INSPECTOR_FILES = {
  "src/probe.ts":
    'import { Session } from "node:inspector";\nexport const probe = () => typeof Session;\n',
  "test/probe.test.ts": [
    'import { expect, it } from "vitest";',
    'import { probe } from "../src/probe.js";',
    'it("sees a session class", () => expect(probe()).toBe("function"));',
    "",
  ].join("\n"),
};

const reasons = (part: Part | undefined) =>
  part?.testFiles.map((f) => [f.path, f.record === undefined ? null : "record", f.noRecord]);

describe("squeal ci record: files without a record (spec 020 D13.1)", () => {
  it("gives a filtered run no record", SLOW, async () => {
    const root = committed(scratch("ci-coverage-filter"), MATH_FILES);
    const run = await recordCovered(root, join(dirname(root), "parts"), ["-t", "adds"]);
    expect(run.code, run.said).toBe(0);
    expect(run.parts[0]?.header.coverage).toMatchObject({ provider: "squeal" });
    expect(reasons(run.parts[0])).toEqual([
      ["test/add.test.ts", null, "filtered"],
      ["test/grade.test.ts", null, "filtered"],
    ]);
    expect(run.parts[0]?.coverage).toBeUndefined();
    expect(run.said).toContain("coverage records for 0 of 2 test files");

    // A location filter runs part of the one file it names.
    const lines = await recordCovered(root, join(dirname(root), "lines"), ["test/add.test.ts:3"]);
    expect(lines.code, lines.said).toBe(0);
    expect(reasons(lines.parts[0])).toEqual([["test/add.test.ts", null, "filtered"]]);
  });

  it("gives a project run with isolate: false no record", SLOW, async () => {
    const root = committed(scratch("ci-coverage-isolate"), MATH_FILES);
    const run = await recordCovered(root, join(dirname(root), "parts"), ["--no-isolate"]);
    expect(run.code, run.said).toBe(0);
    expect(reasons(run.parts[0])).toEqual([
      ["test/add.test.ts", null, "isolate-false"],
      ["test/grade.test.ts", null, "isolate-false"],
    ]);
  });

  it("gives a file whose worker ran an import of node:inspector no record", SLOW, async () => {
    const root = committed(scratch("ci-coverage-inspector"), { ...MATH_FILES, ...INSPECTOR_FILES });
    const run = await recordCovered(root, join(dirname(root), "parts"));
    expect(run.code, run.said).toBe(0);
    const part = run.parts[0] as Part;
    expect(reasons(part)).toEqual([
      ["test/add.test.ts", "record", undefined],
      ["test/grade.test.ts", "record", undefined],
      ["test/probe.test.ts", null, "inspector"],
    ]);
    // The other files' records hold no path of the probe.
    const paths = part.testFiles.flatMap((f) => partRecord(part, f)?.sources ?? []);
    expect(paths.map((s) => s.path)).not.toContain("src/probe.ts");
  });
});
