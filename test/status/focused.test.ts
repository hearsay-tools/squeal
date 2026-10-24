import { describe, expect, it } from "vitest";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import {
  focusedRun,
  keyOf,
  NOW,
  OTHER,
  PARITY,
  ref,
  seedFile,
  test,
  worktree,
  writeRuns,
} from "./focused-fixture.js";

/*
 * Row 011-146 (011 C6 as amended 2026-10-23): status prints a
 * `Focused (not counted)` line per test file whose focused entry applies,
 * its key still the file's and no result stored there; `--json` carries
 * every entry with `applies`; a focused run in flight is named among the
 * running files, and no count moves.
 */

function snapshotOf(root: string): StatusSnapshot {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

const linesOf = (s: StatusSnapshot, full = false) =>
  formatStatus(s, NOW, "squeal", { full }).split("\n");

describe("status shows a focused run while it applies (011 C6, row 011-146)", () => {
  it("prints the line after the failures and before Affected checks, and --json applies", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued", ["claude U2 ci and timer open", "codex U1"]);
    writeRuns(store, id, [
      focusedRun(PARITY, { fails: ["claude U2 ci and timer open", "claude U3 a human message"] }),
    ]);

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    const line = `Focused (not counted): ${PARITY} at revision 4: 2 of 2 selected checks FAIL (claude U2 ci and timer open, claude U3 a human message); its own run is queued.`;
    expect(lines).toContain(line);
    expect(lines.indexOf(line)).toBe(lines.findIndex((l) => l.startsWith("Affected checks:")) - 1);
    expect(s.focused).toHaveLength(1);
    expect(s.focused?.[0]).toMatchObject({
      testFile: ref(PARITY),
      applies: true,
      durationMs: 7_800,
      matched: 2,
      collected: 78,
      texts: ["claude U"],
    });
    expect(s.focused?.[0]?.checks[0]).toMatchObject({
      name: `${PARITY} > claude U2 ci and timer open`,
      outcome: "fail",
      location: { path: PARITY, line: 30, column: 22 },
    });
    // Never counted: no known failure and the same pending counts as without it.
    expect(s.knownFailures).toEqual([]);
    expect(s.testFilesByPhase).toEqual({ running: 0, queued: 1 });
    expect(lines.find((l) => l.startsWith("Known failures:"))).toMatch(/^Known failures: 0;/);
  });

  it("--full lists the selected checks, each with its error and location", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued");
    writeRuns(store, id, [focusedRun(PARITY, { passes: ["codex U1"] })]);

    const lines = linesOf(snapshotOf(repo.main), true);

    const at = lines.findIndex((l) => l.startsWith("Focused (not counted):"));
    expect(lines[at]).toContain("1 of 2 selected checks FAIL (claude U2 ci and timer open)");
    expect(lines.slice(at + 1, at + 5)).toEqual([
      "  FAIL  claude U2 ci and timer open",
      "        AssertionError: expected 'a' to contain 'b'",
      `        at ${PARITY}:30:22`,
      "  pass  codex U1",
    ]);
  });

  it("prints nothing once the key moved or a result is stored at the key; --json keeps it, not applying", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued", ["holds"], keyOf(PARITY, 2));
    seedFile(store, id, OTHER, null);
    store.results.putMany([result(test(OTHER, "holds"), keyOf(OTHER))]);
    writeRuns(store, id, [focusedRun(PARITY), focusedRun(OTHER, { key: keyOf(OTHER) })]);

    const s = snapshotOf(repo.main);

    expect(linesOf(s).filter((l) => l.startsWith("Focused"))).toEqual([]);
    expect(s.focused?.map((f) => [f.testFile.path, f.applies])).toEqual([
      [PARITY, false],
      [OTHER, false],
    ]);
  });

  it("a selection that matched nothing says so with what the run collected", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued");
    writeRuns(store, id, [focusedRun(PARITY, { fails: [], matched: 0, texts: ["nope"] })]);

    expect(linesOf(snapshotOf(repo.main))).toContain(
      `Focused (not counted): ${PARITY} at revision 4: no check holds "nope" (the run collected 78 checks); its own run is queued.`,
    );
  });

  it("names at most three files, the newest first, then how many more", () => {
    const { repo, store, id } = worktree();
    const paths = ["src/f1.test.ts", "src/f2.test.ts", "src/f3.test.ts", "src/f4.test.ts"];
    for (const path of paths) seedFile(store, id, path, "queued");
    writeRuns(
      store,
      id,
      paths.map((path) => focusedRun(path)),
    );

    const lines = linesOf(snapshotOf(repo.main)).filter((l) => /^(Focused| {2}and)/.test(l));

    expect(lines.map((l) => l.split(" at revision")[0])).toEqual([
      "Focused (not counted): src/f4.test.ts",
      "Focused (not counted): src/f3.test.ts",
      "Focused (not counted): src/f2.test.ts",
      "  and 1 more",
    ]);
  });
});

describe("a focused run in flight is named among the running files (011 C6, row 011-146)", () => {
  it("moves its file from Queued to Running with its texts; the counts stay", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued");
    seedFile(store, id, OTHER, "queued");
    writeRuns(store, id, [
      focusedRun(PARITY, { endedAt: null, end: null, matched: null, collected: null, fails: [] }),
    ]);

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    expect(lines).toContain(`Running: 1 test file: ${PARITY} (focused: "claude U")`);
    expect(lines).toContain(`Queued: 1 test file: ${OTHER}`);
    expect(lines.find((l) => l.startsWith("Focused (not counted):"))).toMatch(
      /at revision 4: running since \d\d:\d\d:\d\d \(focused: "claude U"\); its own run is queued\.$/,
    );
    // Only the text moves it: the payload's phases and counts are the queue's.
    expect(s.testFilesByPhase).toEqual({ running: 0, queued: 2 });
    expect(s.pendingTestFiles?.running.files).toEqual([]);
    expect(s.pendingTestFiles?.queued.files).toEqual([ref(OTHER), ref(PARITY)]);
    expect(s.breakdown.pendingByPhase).toMatchObject({ running: 0, queued: 2 });
  });

  it("past the first 100 queued names too, out of the omitted count (review 0.1.286 B5)", () => {
    const { repo, store, id } = worktree();
    const paths = Array.from(
      { length: 101 },
      (_, i) => `src/f${String(i).padStart(3, "0")}.test.ts`,
    );
    for (const path of paths) seedFile(store, id, path, "queued");
    const last = "src/f100.test.ts";
    writeRuns(store, id, [
      focusedRun(last, { endedAt: null, end: null, matched: null, collected: null, fails: [] }),
    ]);

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    expect(lines).toContain(`Running: 1 test file: ${last} (focused: "claude U")`);
    expect(lines).toContain(
      "Queued: 100 test files: src/f000.test.ts, src/f001.test.ts, src/f002.test.ts, src/f003.test.ts, src/f004.test.ts and 95 more",
    );
    expect(lines.find((l) => l.startsWith("Focused (not counted):"))).toMatch(
      /its own run is queued\.$/,
    );
    // The payload stays the queue's: 101 queued, the first 100 named, one omitted.
    expect(s.testFilesByPhase).toEqual({ running: 0, queued: 101 });
    expect(s.pendingTestFiles?.queued.files).toHaveLength(100);
    expect(s.pendingTestFiles?.queued.omitted).toBe(1);
    expect(s.pendingTestFiles?.running.files).toEqual([]);
  });

  it("a file nothing queued is named running, and its own run not queued", () => {
    const { repo, store, id } = worktree();
    store.testFileKeys.upsertMany([
      {
        worktreeId: id,
        testFile: ref(PARITY),
        key: keyOf(PARITY),
        revision: 4 as never,
        pending: null,
      },
    ]);
    seedFile(store, id, OTHER, "queued");
    writeRuns(store, id, [
      focusedRun(PARITY, { endedAt: null, end: null, matched: null, collected: null, fails: [] }),
    ]);

    const s = snapshotOf(repo.main);
    const lines = linesOf(s);

    expect(lines).toContain(`Running: 1 test file: ${PARITY} (focused: "claude U")`);
    expect(lines).toContain(`Queued: 1 test file: ${OTHER}`);
    expect(lines.find((l) => l.startsWith("Focused (not counted):"))).toMatch(
      /its own run is not queued\.$/,
    );
    expect(s.testFilesByPhase).toEqual({ running: 0, queued: 1 });
  });
});
