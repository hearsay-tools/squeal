import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { formatDelta } from "../../src/core/delivery/index.js";
import { formatCheck } from "../../src/core/status/index.js";
import type { Delta, ResultRecord, TestCheckId } from "../../src/core/types/index.js";
import { shellWords } from "../../src/harness/shared/test-command.js";
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

/**
 * A stored failure of `c`, `minutesAgo` old, with the error the group shares or `message`; each
 * age is its own key, as each edit of a test file's closure gives one.
 */
function failed(
  c: TestCheckId,
  worktreeId: string,
  minutesAgo: number,
  message = "ResizeObserver is not defined",
): ResultRecord {
  const base = result(c, `key-${c.testPath}-${c.fullName}-${minutesAgo}`, {
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

const ERROR = "ReferenceError: ResizeObserver is not defined";

/** The `FAIL` lines of a `squeal failures` listing, by the check each names. */
function listed(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("  FAIL  "))
    .map((line) => line.split("  ").at(-1) ?? "");
}

describe("a grouped notice keeps every check's evidence (row 011-109)", () => {
  // Review 0.1.262 B1: the command selected the group's directory with the group's size as its
  // limit, so 25 newer failures in the same files left 25 of the group out.
  it("lists all 91 checks through its one `squeal failures` command, among newer failures and older rows in their files", () => {
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
    const file = (i: number) => `tests/components/f${i % 7}.test.tsx`;
    const group = Array.from({ length: 91 }, (_, i) => check(file(i), `renders case ${i}`));
    // In the group's files: 25 newer failures with another error, and one older failure with the
    // group's error of a check the notice does not name (it failed before, the same way).
    const others = Array.from({ length: 25 }, (_, i) => check(file(i), `fetches case ${i}`));
    const before = check(file(0), "measures");
    store.results.putMany([
      ...group.map((c) => failed(c, repo.mainId, 10)),
      // Each check of the group failed twice before with its error, and once with another.
      ...group.flatMap((c) => [20, 30].map((age) => failed(c, repo.mainId, age))),
      ...group.map((c) => failed(c, repo.mainId, 40, "window is not defined")),
      ...others.flatMap((c, i) => [
        failed(c, repo.mainId, 1 + i / 100, "fetch failed"),
        failed(c, repo.mainId, 50, "fetch failed"),
      ]),
      failed(before, repo.mainId, 60),
    ]);
    store.knownStates.upsertMany(
      [...group, ...others, before].map((c) =>
        state(repo.mainId, c, { outcome: "fail", observedAt: 4 }),
      ),
    );

    const delta: Delta = {
      schemaVersion: 1,
      consumer: { worktreeId: repo.mainId, sessionId: "s", agentId: "main" },
      header: {
        revision: 4,
        counts: { current: 117, pending: 0, stale: 0, unknown: 0 },
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
        summary: ERROR,
        location: CHART,
      })),
    };
    const text = formatDelta(delta);
    const commands = text.split("\n").filter((line) => line.startsWith("      Full list: "));
    expect(commands).toHaveLength(1);
    const command = commands[0]?.slice("      Full list: ".length) ?? "";
    expect(command).toBe(
      `squeal failures tests/components --error "${ERROR}" --per-check --limit all`,
    );

    const listing = run(shellWords(command)?.slice(1) ?? [], repo.main);
    expect(listing.code).toBe(0);
    const names = listed(listing.stdout);
    // Each check of the group once, and the older failure with its error, which it also selects.
    expect(names.toSorted()).toEqual([...group, before].map(formatCheck).toSorted());
    expect(listing.stdout).toContain("(92 checks, newest failure of each, newest first):");

    for (const c of group) {
      const why = run(["why", formatCheck(c)], repo.main);
      expect(why.code).toBe(0);
      expect(why.stdout).toContain(`Check: ${formatCheck(c)}\n`);
      expect(why.stdout).toContain(ERROR);
    }
  });
});
