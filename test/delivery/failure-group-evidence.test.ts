import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { LISTED_BY_DEFAULT } from "../../src/core/delivery/failure-groups.js";
import { formatDelta } from "../../src/core/delivery/index.js";
import { FAILURES_LIMIT, formatCheck } from "../../src/core/status/index.js";
import type { Delta, ResultRecord, TestCheckId } from "../../src/core/types/index.js";
import { check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { result } from "../store/helpers.js";

// Row 011-109: a group is a way of printing, never of storing. The `squeal failures` command a
// grouped notice names lists every check of its group, and `why` gives each one its own evidence.

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 22, 9, 0, 0);
const CHART = { path: "src/components/chart.tsx", line: 12, column: 5 };

function run(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    now: () => NOW,
    env: {},
  };
  return { code: main(argv, io), stdout };
}

/** A stored failure of `c`, `minutesAgo` old, with the error the group shares or `message`. */
function failed(
  c: TestCheckId,
  worktreeId: string,
  minutesAgo: number,
  message = "ResizeObserver is not defined",
): ResultRecord {
  const base = result(c, `key-${c.testPath}-${c.fullName}`, {
    outcome: "fail",
    worktreeId,
    recordedAt: NOW - minutesAgo * MINUTE,
    runId: `run-${minutesAgo}`,
    errors: [
      {
        name: "ReferenceError",
        message,
        stack: `ReferenceError: ${message}\n    at src/components/chart.tsx:12:5`,
        location: CHART,
        diff: null,
      },
    ],
  });
  return {
    ...base,
    location: CHART,
    summary: `ReferenceError: ${message}`,
    fingerprint: `ReferenceError: ${message} @ src/components/chart.tsx:12:5`,
  };
}

describe("a grouped notice keeps every check's evidence (row 011-109)", () => {
  it("lists all 91 checks through its one `squeal failures` command, and `why` gives each", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    store.worktrees.upsert({
      id: repo.mainId,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    const group = Array.from({ length: 91 }, (_, i) =>
      check(`tests/components/f${i % 7}.test.tsx`, `renders case ${i}`),
    );
    // Older failures elsewhere, more than the default limit, stay out of the group's listing.
    const others = Array.from({ length: 25 }, (_, i) => check(`tests/api/a${i}.test.ts`, "posts"));
    store.results.putMany([
      ...group.map((c) => failed(c, repo.mainId, 1)),
      ...others.map((c, i) => failed(c, repo.mainId, 30 + i, "fetch failed")),
    ]);
    store.knownStates.upsertMany(
      [...group, ...others].map((c) => state(repo.mainId, c, { outcome: "fail", observedAt: 4 })),
    );

    const delta: Delta = {
      schemaVersion: 1,
      consumer: { worktreeId: repo.mainId, sessionId: "s", agentId: "main" },
      header: {
        revision: 4,
        counts: { current: 116, pending: 0, stale: 0, unknown: 0 },
        testFilesWithoutChecks: { pending: 0, unknown: 0 },
        fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      },
      label: "transitions",
      entries: group.map((c) => ({
        check: c,
        kind: "pass-to-fail",
        from: "pass",
        to: "fail",
        validity: "current",
        observedAt: 4,
        origin: { kind: "own" },
        summary: "ReferenceError: ResizeObserver is not defined",
        location: CHART,
      })),
    };
    const command = /^ {6}Full list: (.*)$/m.exec(formatDelta(delta))?.[1] ?? "";
    expect(command).toBe("squeal failures tests/components --limit 91");

    const listing = run(command.split(" ").slice(1), repo.main);
    expect(listing.code).toBe(0);
    expect(listing.stdout).toContain("(91 failures, newest first):");
    const names = listing.stdout
      .split("\n")
      .filter((line) => line.startsWith("  FAIL  "))
      .map((line) => line.split("  ").at(-1));
    expect(new Set(names)).toEqual(new Set(group.map(formatCheck)));

    for (const c of group) {
      const why = run(["why", formatCheck(c)], repo.main);
      expect(why.code).toBe(0);
      expect(why.stdout).toContain(`Check: ${formatCheck(c)}\n`);
      expect(why.stdout).toContain("ReferenceError: ResizeObserver is not defined");
    }
  });

  it("names a limit only above the one `squeal failures` lists by default", () => {
    expect(LISTED_BY_DEFAULT).toBe(FAILURES_LIMIT);
  });
});
