import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, partRecord } from "../../../src/core/ci/parts.js";
import {
  COVERAGE_PROVIDER_VERSION,
  COVERAGE_RECORD_VERSION,
} from "../../../src/core/code/coverage/record.js";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { committed, scratch } from "../../ci/fixture.js";
import { ADAPTERS, changedSet } from "../../code/gate/collect-fixture.js";
import { MATH_FILES, recordCovered } from "./ci-coverage-kit.js";

/*
 * Spec 020 D13.1 (row 020-08a): `squeal ci record` adds Squeal's coverage
 * provider to the project's own Vitest run and writes each completed whole
 * file's record into its `squeal-ci-part/4` part. The records equal the
 * ones the gate's own collector (`collectEvidence`, row 020-03) makes of
 * the same files: one mapping, two ways to run.
 */

const SLOW = { timeout: 300_000 } as const;

describe("squeal ci record with Squeal's coverage provider (spec 020 D13)", () => {
  it("writes each file's record, equal to the gate collector's", SLOW, async () => {
    const root = committed(scratch("ci-coverage"), MATH_FILES);
    const run = await recordCovered(root, join(dirname(root), "parts"));
    expect(run.code, run.said).toBe(0);
    expect(run.parts).toHaveLength(1);
    const part = run.parts[0] as Part;
    expect(part.format).toBe("squeal-ci-part/4");
    expect(part.header.coverage).toEqual({
      provider: "squeal",
      providerVersion: COVERAGE_PROVIDER_VERSION,
      recordVersion: COVERAGE_RECORD_VERSION,
    });
    expect(run.said).toContain("squeal ci record: coverage records for 2 of 2 test files\n");

    const changed = await changedSet(root, ["src/math.ts"]);
    const options = { tests: [], budgetSeconds: 600, adapters: ADAPTERS };
    const gate = await collectEvidence(root, changed, options);
    expect(gate.testFiles.map((f) => [f.path, f.completed])).toEqual([
      ["test/add.test.ts", true],
      ["test/grade.test.ts", true],
    ]);
    const records = part.testFiles.map((file) => [file.path, partRecord(part, file)]);
    expect(records).toEqual(gate.testFiles.map((f) => [f.path, f.record]));
    for (const [, record] of records) {
      expect(typeof record === "object" && record?.sources.map((s) => s.path)).toContain(
        "src/math.ts",
      );
    }
    expect(part.testFiles.map((f) => f.noRecord)).toEqual([undefined, undefined]);
  });
});
