import { describe, expect, it } from "vitest";
import { formatImpact } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import { fakeGraph, record, snapshot, testFile } from "./fixture.js";

/*
 * Row 015-129 (spec 015 D11 as amended 2026-11-23): `--offset <n>` skips
 * that many entries of each ranked list and of each named route's test
 * files, numbers from `offset + 1`, and names the next page.
 */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 4 };

const contract = "src/contract.ts";
const engine = "src/engine.ts";
const graph = fakeGraph({
  ...Object.fromEntries(
    ["a", "b", "c", "d"].map((n) => [`test/${n}.test.ts`, ["test/kit.ts", contract]]),
  ),
  "test/kit.ts": [engine],
  [contract]: [],
  [engine]: [],
});
const tests = ["a", "b", "c", "d"].map((n, i) =>
  testFile(`test/${n}.test.ts`, [`test/${n}.test.ts`, "test/kit.ts", contract, engine], {
    seconds: i + 1,
    coverage: record([engine], [contract]),
  }),
);
const edits = [
  { at: 10, paths: [engine] },
  { at: 20, paths: [engine] },
  { at: 30, paths: [contract] },
  { at: 40, paths: ["test/kit.ts"] },
];
const snap = snapshot(tests, { edits, graph });
const report = (options: Partial<ReportOptions>) => buildReport(snap, { ...OPTIONS, ...options });
const all = report({});

describe("--offset on the ranked lists", () => {
  it("has more than one entry in each list, so a page can be taken", () => {
    expect(all.files.length).toBeGreaterThan(1);
    expect(all.byEdits.length).toBeGreaterThan(1);
    expect(all.testFiles.length).toBeGreaterThan(1);
    expect(all.gateways.length).toBeGreaterThan(0);
    expect(all).toMatchObject({
      offset: 0,
      totalFiles: all.files.length,
      totalByEdits: all.byEdits.length,
      totalTestFiles: all.testFiles.length,
      totalGateways: all.gateways.length,
    });
  });

  it("gives page 2 as the second entry of each list, with its totals", () => {
    const page = report({ limit: 1, offset: 1 });
    expect(page.offset).toBe(1);
    expect(page.files).toEqual(all.files.slice(1, 2));
    expect(page.byEdits).toEqual(all.byEdits.slice(1, 2));
    expect(page.testFiles).toEqual(all.testFiles.slice(1, 2));
    expect(page.gateways).toEqual(all.gateways.slice(1, 2));
    expect(page.moreFiles).toBe(all.files.length - 2);
    expect(page.moreTestFiles).toBe(all.testFiles.length - 2);
    expect(page.moreByEdits).toBe(Math.max(0, all.byEdits.length - 2));
    expect(page.totalTestFiles).toBe(all.testFiles.length);
  });

  it("gives every remaining entry when --offset comes without --limit", () => {
    const rest = report({ offset: 1 });
    expect(rest.testFiles).toEqual(all.testFiles.slice(1));
    expect(rest.moreTestFiles).toBe(0);
    expect(rest.files).toEqual(all.files.slice(1));
  });

  it("numbers from offset + 1 and names the next page in the footer", () => {
    const text = formatImpact(report({ limit: 1, offset: 1 }));
    const test = all.testFiles[1];
    expect(text).toContain(`  2. ${test?.path}, ${test?.seconds} s\n`);
    expect(text).toContain(
      `  … and ${all.testFiles.length - 2} more; --offset 2 lists the next page, or --limit lists more.\n`,
    );
    expect(text).toContain(`  2. ${all.byEdits[1]?.files[0]}: `);
    expect(text).toContain(`  ${all.files[1]?.rank}. ${all.files[1]?.files[0]}\n`);
    expect(text).not.toContain("  1. ");
  });

  it("past the end of every list, keeps the edit sections first and says what the offset skipped", () => {
    const past = report({ limit: 1, offset: 9 });
    expect(past).toMatchObject({
      files: [],
      byEdits: [],
      testFiles: [],
      gateways: [],
      moreFiles: 0,
      moreByEdits: 0,
      moreTestFiles: 0,
      moreGateways: 0,
    });
    const text = formatImpact(past);
    expect(text).toContain(
      `Top gateways, by seconds re-run over the window's edits:\n  none at offset 9 (${all.gateways.length} in all).\n`,
    );
    expect(text).toContain(
      `Files, by seconds re-run over the window's edits:\n  none at offset 9 (${all.byEdits.length} in all).\n`,
    );
    expect(text).toContain(`  none at offset 9 (${all.files.length} in all).\n`);
    expect(text).toContain(`  none at offset 9 (${all.testFiles.length} in all).\n`);
    expect(text).not.toContain("no edit in the window");
    expect(text.indexOf("Top gateways")).toBeLessThan(
      text.indexOf("Files, by avoidable seconds per edit"),
    );
  });
});

describe("--offset on a named file", () => {
  const named = (offset: number) => {
    const [file] = report({ paths: [engine], limit: 1, offset }).named ?? [];
    return { routes: file?.routes ?? [], route: file?.routes[0] };
  };

  it("pages each route's test files and keeps its routes", () => {
    const first = named(0);
    const second = named(1);
    expect(second.routes).toHaveLength(first.routes.length);
    expect(first.route?.testFiles).toBe(4);
    expect(second.route?.testFiles).toBe(4);
    expect(first.route?.tests).toHaveLength(1);
    expect(second.route?.tests).toHaveLength(1);
    expect(second.route?.tests[0]?.path).not.toBe(first.route?.tests[0]?.path);
    expect(second.route?.moreTests).toBe(2);
    expect(formatImpact(report({ paths: [engine], limit: 1, offset: 1 }))).toContain(
      "    … and 2 more test files; --offset 2 lists the next page, or --limit lists more.\n",
    );
  });

  it("says so for a route with fewer test files than the offset, and keeps every route", () => {
    const past = report({ paths: [engine], limit: 1, offset: 9 });
    const file = past.named?.[0];
    expect(file?.routes[0]?.tests).toEqual([]);
    expect(file?.routes[0]?.moreTests).toBe(0);
    const text = formatImpact(past);
    expect(text).toContain(
      `    none at offset 9 (${file?.routes[0]?.testFiles} test files in all).\n`,
    );
  });
});
