import { describe, expect, it } from "vitest";
import {
  COMMIT_REPORTS_KEPT,
  type CommitReport,
  commitReportsMetaKey,
  newestCommitReport,
  readCommitReport,
  readCommitReports,
  writeCommitReports,
} from "../../src/core/commit/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 019-13 (spec 019 D5 step 3): reports stored per commit SHA in the
 * worktree's one `commitReports` row, newest first and bounded, with the
 * `HEAD` the daemon last looked at.
 */

const W = "w1";
const sha = (n: number) => n.toString(16).padStart(40, "0");
const report = (n: number, failures = 0): CommitReport => ({
  commit: sha(n),
  revision: n,
  at: n,
  tests: { files: 1, failures, notDetermined: 0, running: 0, unknown: 0 },
});

describe("commit reports in the store (019-13)", () => {
  it("keeps one report per SHA, newest first, and the HEAD looked at", () => {
    const store = open(fakeCommonDir());
    expect(readCommitReports(store.meta, W)).toBeNull();
    writeCommitReports(store.meta, W, sha(1), report(1));
    writeCommitReports(store.meta, W, sha(2), report(2));
    writeCommitReports(store.meta, W, sha(1));
    expect(readCommitReports(store.meta, W)).toEqual({
      seen: sha(1),
      reports: [report(2), report(1)],
    });
    expect(newestCommitReport(store.meta, W)).toEqual(report(2));
    expect(readCommitReport(store.meta, W, sha(1))).toEqual(report(1));
    expect(readCommitReport(store.meta, W, sha(3))).toBeNull();
  });

  it("replaces a SHA's older report and drops the oldest past the bound", () => {
    const store = open(fakeCommonDir());
    for (let n = 1; n <= COMMIT_REPORTS_KEPT + 2; n++)
      writeCommitReports(store.meta, W, sha(n), report(n));
    writeCommitReports(store.meta, W, sha(5), report(5, 7));
    const { reports } = readCommitReports(store.meta, W) ?? { reports: [] };
    expect(reports).toHaveLength(COMMIT_REPORTS_KEPT);
    expect(reports[0]).toEqual(report(5, 7));
    expect(reports.filter((r) => r.commit === sha(5))).toHaveLength(1);
    expect(reports.map((r) => r.commit)).not.toContain(sha(1));
    expect(reports.map((r) => r.commit)).not.toContain(sha(2));
  });

  it("keeps the HEAD a report moved from and its untracked count; an older row reads without them (019-28)", () => {
    const store = open(fakeCommonDir());
    const base = report(2);
    const made: CommitReport = {
      ...base,
      from: sha(1),
      tests: { files: 1, failures: 0, notDetermined: 1, untracked: 1, running: 0, unknown: 0 },
    };
    writeCommitReports(store.meta, W, sha(2), made);
    expect(newestCommitReport(store.meta, W)).toEqual(made);
    writeCommitReports(store.meta, W, sha(3), report(3));
    expect(newestCommitReport(store.meta, W)).toEqual(report(3));
    expect(newestCommitReport(store.meta, W)).not.toHaveProperty("from");
  });

  it("keeps the not-determined files with their paths; drops an entry that is not one (019-37, P11)", () => {
    const store = open(fakeCommonDir());
    const named = [
      { project: "", path: "test/a.test.ts", through: ["src/a.ts"], more: 2 },
      { project: "web", path: "test/b.test.ts", through: [], deleted: true as const },
    ];
    const made: CommitReport = {
      ...report(2),
      tests: {
        files: 2,
        failures: 0,
        notDetermined: 2,
        running: 0,
        unknown: 0,
        notDeterminedFiles: named,
      },
    };
    writeCommitReports(store.meta, W, sha(2), made);
    expect(newestCommitReport(store.meta, W)).toEqual(made);
    const raw = JSON.parse(store.meta.get(commitReportsMetaKey(W)) ?? "{}");
    raw.reports[0].tests.notDeterminedFiles.push(
      { project: "", path: 3, through: [] },
      { path: "x" },
    );
    store.meta.set(commitReportsMetaKey(W), JSON.stringify(raw));
    expect(newestCommitReport(store.meta, W)).toEqual(made);
  });

  it("stores a failed report with its reason, and reads a row that is not one as none", () => {
    const store = open(fakeCommonDir());
    const failed: CommitReport = { commit: sha(1), revision: 1, at: 1, failed: "no tree" };
    writeCommitReports(store.meta, W, sha(1), failed);
    expect(newestCommitReport(store.meta, W)).toEqual(failed);
    store.meta.set(commitReportsMetaKey(W), "not json");
    expect(readCommitReports(store.meta, W)).toBeNull();
    store.meta.set(
      commitReportsMetaKey(W),
      JSON.stringify({ seen: sha(1), reports: [{ commit: sha(1) }, report(2)] }),
    );
    expect(readCommitReports(store.meta, W)?.reports).toEqual([report(2)]);
  });
});
