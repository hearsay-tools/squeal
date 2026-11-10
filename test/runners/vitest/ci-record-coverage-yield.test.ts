import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { committed, scratch, VITEST } from "../../ci/fixture.js";
import { TS_WORKER } from "../../code/coverage/payloads.js";
import { MATH_FILES, recordCovered } from "./ci-coverage-kit.js";

/*
 * Spec 020 D13.1 (row 020-08a): `ci record` never changes the command's
 * exit code. A run with coverage of its own keeps it: Squeal's provider is
 * not added, the project's report is written and its failed threshold still
 * fails the run (`research/ci-evidence.md` Q4). An error of Squeal's own
 * is a reason in the part, never in the run.
 */

const SLOW = { timeout: 300_000 } as const;
const OWN_COVERAGE = resolve(import.meta.dirname, "../../fixtures/vitest/own-coverage");

/** The fixture with its own coverage provider off in its config, as a CI run turns it on with `--coverage`. */
function ownCoverage(): string {
  return committed(scratch("ci-coverage-own"), {}, (root) => {
    cpSync(OWN_COVERAGE, root, { recursive: true });
    const config = join(root, "vitest.config.ts");
    writeFileSync(config, readFileSync(config, "utf8").replace("enabled: true", "enabled: false"));
  });
}

describe("squeal ci record: the run's own coverage and errors (spec 020 D13.1)", () => {
  it(
    "yields to --coverage: exit 1 kept, the project's report written, no record",
    SLOW,
    async () => {
      const plainRoot = ownCoverage();
      const plain = spawnSync(process.execPath, [VITEST, "run", "--coverage"], { cwd: plainRoot });
      expect(plain.status).toBe(1);

      const root = ownCoverage();
      const run = await recordCovered(root, join(dirname(root), "parts"), ["--coverage"]);
      expect(run.code, run.said).toBe(1);
      expect(existsSync(join(root, "coverage/coverage-final.json"))).toBe(true);
      const part = run.parts[0];
      expect(part?.header.coverage).toEqual({
        off: "project-coverage",
        note: "the run has coverage of its own (coverage.enabled), and a Vitest run takes one coverage provider",
      });
      expect(part?.testFiles.map((f) => [f.path, f.record, f.noRecord])).toEqual([
        ["test/math.test.ts", undefined, undefined],
      ]);
      expect(part?.coverage).toBeUndefined();
      expect(run.said).toContain(
        "no coverage records: the run has coverage of its own, so Squeal's provider was not added",
      );
    },
  );

  it("names a records' worker that fails in the part and keeps the exit code", SLOW, async () => {
    const root = committed(scratch("ci-coverage-broken"), {
      ...MATH_FILES,
      "broken-worker.mjs": 'throw new Error("this worker fails on purpose");\n',
    });
    const mapWorker = { ...TS_WORKER, script: join(root, "broken-worker.mjs") };
    const run = await recordCovered(root, join(dirname(root), "parts"), [], { mapWorker });
    expect(run.code, run.said).toBe(0);
    const part = run.parts[0];
    expect(part?.header.coverage).toMatchObject({ provider: "squeal" });
    expect(part?.header.coverage).toHaveProperty(
      "note",
      expect.stringContaining("this worker fails on purpose"),
    );
    expect(part?.testFiles.map((f) => [f.path, f.outcome, f.noRecord])).toEqual([
      ["test/add.test.ts", "pass", "unmapped"],
      ["test/grade.test.ts", "pass", "unmapped"],
    ]);
    expect(run.said).toContain("coverage records for 0 of 2 test files; ");
  });
});
