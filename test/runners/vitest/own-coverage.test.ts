import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { type FixtureProject, openFixture, ref, SLOW } from "./helpers.js";

/** Row 013-07: what the fixture's provider would print, as `@vitest/coverage-v8` does. */
const COVERAGE_OUTPUT = /% Stmts|does not meet global threshold/;

describe("vitest adapter: a project's own coverage setting", SLOW, () => {
  it("leaves its coverage folder, the daemon's output and exit code untouched", async () => {
    const printed: string[] = [];
    const capture = (chunk: string | Uint8Array): boolean => {
      printed.push(String(chunk));
      return true;
    };
    const exitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    let fx: FixtureProject;
    let report: RunReport;
    try {
      fx = await openFixture("own-coverage", { "coverage/index.html": "the developer's report\n" });
      report = await fx.adapter.run([ref("test/math.test.ts")], fx.runOptions());
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(readdirSync(join(fx.root, "coverage"))).toEqual(["index.html"]);
    expect(fx.read("coverage/index.html")).toBe("the developer's report\n");
    expect(printed.filter((chunk) => COVERAGE_OUTPUT.test(chunk))).toEqual([]);
    expect(process.exitCode).toBe(exitCode);
    expect(report.end).toBe("completed");
    expect(report.failure).toBeNull();
    expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([["adds", "pass"]]);
  });
});
