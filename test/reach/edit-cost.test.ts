import { describe, expect, it } from "vitest";
import { formatReach } from "../../src/cli/reach-format.js";
import { buildReport, type ReportOptions } from "../../src/core/reach/report.js";
import type { ReachSnapshot } from "../../src/core/reach/types.js";
import { record, snapshot, testFile } from "./fixture.js";

/*
 * Row 015-118 (`lessons.md` "Edit reach, round 1", defect 11): a second
 * list, by the seconds the window's edits re-ran. With no edits recorded,
 * it says so in one line and ranks nothing.
 */

const OPTIONS: ReportOptions = { paths: null, limit: null, command: "squeal", listed: 3 };
const report = (snap: ReachSnapshot, options: Partial<ReportOptions> = {}) =>
  buildReport(snap, { ...OPTIONS, ...options });

// Cezar's contract files: loaded by every test, never edited; its engine files: edited often, by fewer tests.
const contract = "src/contract.ts";
const engine = "src/engine.ts";
const tests = ["a", "b", "c", "d"].map((n, i) =>
  testFile(`test/${n}.test.ts`, [`test/${n}.test.ts`, contract, ...(i < 2 ? [engine] : [])], {
    seconds: 2,
    coverage: record([engine], [contract]),
  }),
);
const edits = [
  { at: 10, paths: [engine] },
  { at: 20, paths: [engine, "README.md"] },
  { at: 30, paths: [engine] },
];

describe("the list by the window's edits", () => {
  const r = report(snapshot(tests, { edits }));

  it("ranks the entries the edits changed by the seconds those edits re-ran, and leaves the rest out", () => {
    expect(r.files.map((e) => [e.files[0], e.rank])).toEqual([
      [contract, 1],
      [engine, 2],
    ]);
    expect(r.byEdits.map((e) => [e.files, e.edits, e.editSeconds, e.rank])).toEqual([
      [[engine], 3, 12, 2],
    ]);
    expect(r.moreByEdits).toBe(0);
  });

  it("prints one short entry with the rank in the first list", () => {
    expect(formatReach(r)).toContain(
      "Files, by seconds re-run over the window's edits:\n" +
        "  1. src/engine.ts: 3 edits re-ran 12 s, 4 s each; avoidable 0 s; rank 2 above\n",
    );
  });

  it("applies --limit, as to the other lists", () => {
    const more = [...edits, { at: 40, paths: [contract] }];
    const limited = report(snapshot(tests, { edits: more }), { limit: 1 });
    expect(limited.byEdits.map((e) => e.files[0])).toEqual([engine]);
    expect(limited.moreByEdits).toBe(1);
    expect(formatReach(limited)).toContain(
      "  1. src/engine.ts: 3 edits re-ran 12 s, 4 s each; avoidable 0 s; rank 2 above\n" +
        "  … and 1 more; --limit lists more.\n",
    );
    expect(report(snapshot(tests, { edits: more })).byEdits.map((e) => e.files[0])).toEqual([
      engine,
      contract,
    ]);
  });

  it("says in one line that no edits are recorded, and ranks nothing", () => {
    const fresh = report(snapshot(tests));
    expect(fresh).toMatchObject({ window: null, byEdits: [], moreByEdits: 0 });
    const text = formatReach(fresh);
    expect(text).toContain(
      "\n\nFiles, by seconds re-run over the window's edits: none ranked, because no edits are recorded yet.\n\n",
    );
  });

  it("says so when no edit in the window changed a file a test re-runs on", () => {
    const elsewhere = report(snapshot(tests, { edits: [{ at: 5, paths: ["README.md"] }] }));
    expect(elsewhere.byEdits).toEqual([]);
    expect(formatReach(elsewhere)).toContain(
      "Files, by seconds re-run over the window's edits: none; no edit in the window changed a file that a test re-runs on.\n",
    );
  });
});
