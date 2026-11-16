import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { Delta, Registration, TransitionEntry } from "../../src/core/types/delivery.js";
import type { KnownFailure, RecordedFacts, StatusHeader } from "../../src/core/types/status.js";

/*
 * Row 005-92 (research hook-messages-2026-11-16, finding 12): a failure
 * report says a repeated fact once per message, not once per block.
 */

const header: StatusHeader = {
  revision: 9,
  counts: { current: 10, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};

/** A failure of `name` in its own test file, with its own error, so no two group. */
const failure = (name: string, changesInClosure?: string[]): TransitionEntry => ({
  check: { kind: "test", project: "", testPath: `tests/${name}.test.ts`, fullName: name },
  kind: "pass-to-fail",
  from: "pass",
  to: "fail",
  validity: "current",
  observedAt: 9,
  origin: { kind: "own" },
  summary: `expected ${name} to be 2`,
  location: null,
  ...(changesInClosure === undefined ? {} : { changesInClosure }),
});

const delta = (entries: TransitionEntry[]): Delta => ({
  schemaVersion: 1,
  consumer: { worktreeId: "wt-a", sessionId: "s1", agentId: "main" },
  header,
  label: "transitions",
  entries,
});

const CHANGED = ["src/a.ts", "src/b.ts"];
const count = (text: string, part: string) => text.split(part).length - 1;

describe("changed paths a failure's imports hold (row 005-92)", () => {
  it("prints equal paths once, after the blocks, with no 'closure'", () => {
    const text = formatDelta(delta(["a", "b", "c"].map((n) => failure(n, CHANGED))));
    expect(count(text, "src/a.ts, src/b.ts")).toBe(1);
    expect(text).not.toContain("closure");
    expect(text).toContain(
      "\n\nAll 3 failing tests import files changed here since this session started: src/a.ts, src/b.ts\n\nFull output: squeal why 'tests/a.test.ts > a'",
    );
  });

  it("keeps the own line of a failure with other paths, and counts the ones that share", () => {
    const text = formatDelta(
      delta([failure("a", CHANGED), failure("b", ["src/x.ts"]), failure("c", CHANGED)]),
    );
    expect(count(text, "src/a.ts, src/b.ts")).toBe(1);
    expect(text).toContain(
      "      its imports include files changed here since this session started: src/x.ts",
    );
    expect(text).toContain(
      "2 of the 3 failing tests import files changed here since this session started: src/a.ts, src/b.ts",
    );
  });

  it("says once that none of the changes are in the imports of several failures", () => {
    const text = formatDelta(delta([failure("a", []), failure("b", []), failure("c")]));
    expect(count(text, "none of the files changed here")).toBe(0);
    expect(text).toContain(
      "None of the files changed here since this session started are imported by 2 of the 3 failing tests",
    );
  });

  it("keeps a single failure's line in its block", () => {
    const text = formatDelta(delta([failure("a", CHANGED)]));
    expect(text).toContain(
      "      its imports include files changed here since this session started: src/a.ts, src/b.ts",
    );
    expect(text).not.toContain("failing tests import");
  });
});

const NOW = 1_800_000_000_000;

/** A known failure of `name`, recorded in this worktree at `loadPerCpu`. */
const known = (
  name: string,
  facts: Partial<RecordedFacts> | null,
  changesInClosure?: string[],
): KnownFailure => ({
  check: { kind: "test", project: "", testPath: `tests/${name}.test.ts`, fullName: name },
  outcome: "fail",
  validity: "current",
  observedAt: 9,
  summary: `expected ${name} to be 2`,
  fingerprint: `AssertionError: expected ${name} to be 2`,
  location: null,
  ...(facts === null
    ? {}
    : {
        recorded: {
          worktreeId: "wt-a",
          worktreeRoot: null,
          revision: 4 as never,
          recordedAt: NOW - 3 * 60_000,
          loadPerCpu: 2,
          ...facts,
        },
      }),
  ...(changesInClosure === undefined ? {} : { changesInClosure }),
});

const registration = (knownFailures: KnownFailure[]): Registration => ({
  schemaVersion: 1,
  consumer: { worktreeId: "wt-a", sessionId: "s1", agentId: "main" },
  header,
  knownFailures,
});

const registered = (failures: KnownFailure[]) =>
  formatRegistration(registration(failures), undefined, "squeal", NOW);

const BELOW = "once more when the one-minute load average is below the CPU count";

describe("a registration's retry advice (row 005-92)", () => {
  it("is printed once, and each failure keeps its own age, revision and load in one line", () => {
    const text = registered([
      known("a", { noEarlierPass: true }),
      known("b", { noEarlierPass: true, loadPerCpu: 3.5, recordedAt: NOW - 3 * 3_600_000 }),
      known("c", { noEarlierPass: true, revision: 7 as never }),
    ]);
    expect(count(text, "--reason load")).toBe(1);
    expect(count(text, "look first")).toBe(1);
    expect(text).toContain(
      "      Recorded 3 min ago in this worktree at revision 4, load 2.00 per CPU when it ran; no pass at these inputs is on record before it; no retry asked at these inputs\n",
    );
    expect(text).toContain(
      "      Recorded 3 h ago in this worktree at revision 4, load 3.50 per CPU when it ran;",
    );
    expect(text).toContain("      Recorded 3 min ago in this worktree at revision 7, load 2.00");
    expect(text).toContain(
      `\n\nWhere no pass at these inputs is on record before a failure, look first at the changed files it reads; if the changed files are not the cause, \`squeal retry tests/a.test.ts tests/b.test.ts tests/c.test.ts --reason load\` runs them ${BELOW}\n\nFull output: squeal why 'tests/a.test.ts > a'`,
    );
  });

  it("names long test files by the placeholder, so the header and the blocks keep their room (review 0.1.525, B1)", () => {
    const long = (i: number) => `${"deep/".repeat(470)}f${i}`;
    const failures = [0, 1, 2, 3, 4].map((i) => known(long(i), { noEarlierPass: true }));
    const text = registered(failures);
    expect(text.length).toBeLessThanOrEqual(10_000);
    expect(text.startsWith("SQUEAL · registered at revision 9\n")).toBe(true);
    expect(text).toContain("\n\nFAIL  ");
    expect(text).toContain(`\`squeal retry <test file>... --reason load\` runs them ${BELOW}`);
  });

  it("cuts a shared changed-imports line of long paths (review 0.1.525, B1)", () => {
    const paths = [0, 1, 2].map((i) => `${"deep/".repeat(470)}s${i}.ts`);
    const text = registered([known("a", {}, paths), known("b", {}, paths), known("c", {}, paths)]);
    const line = text.split("\n").find((l) => l.startsWith("All 3 failing tests import")) ?? "";
    expect(line.length).toBe(1_000);
    expect(text.startsWith("SQUEAL · registered at revision 9\n")).toBe(true);
  });

  it("names only the failures recorded busy with no retry asked, and no changed-files clause for one with an earlier pass", () => {
    const text = registered([
      known("a", { loadPerCpu: 0.4 }),
      known("b", {}),
      known("c", { retry: { reason: "load", outcome: "failed" } }),
    ]);
    expect(text).toContain(
      `\n\n\`squeal retry tests/b.test.ts --reason load\` runs it ${BELOW}\n\n`,
    );
    expect(text).toContain("; retry asked (load) at these inputs: it failed again\n");
    expect(text).not.toContain("look first");
  });

  it("is none when no failure is busy or new", () => {
    const text = registered([known("a", { loadPerCpu: 0.4 }), known("b", { loadPerCpu: null })]);
    expect(text).not.toContain("retry tests/");
    expect(text).toContain("no retry asked at these inputs\n");
  });

  it("stays in the block of the one recorded failure, as before", () => {
    const text = registered([known("a", { noEarlierPass: true }), known("b", null)]);
    expect(text).toContain(
      `      No pass at these inputs is on record before this failure: look first at the changed files it reads; recorded 3 min ago in this worktree at revision 4, load 2.00 per CPU when it ran; no retry asked at these inputs; if the changed files are not the cause, \`squeal retry tests/a.test.ts --reason load\` runs it ${BELOW}\n`,
    );
  });
});

describe("a registration's changed imports (row 005-92)", () => {
  it("prints equal paths once, after the blocks, before the retry advice", () => {
    const text = registered([
      known("a", {}, CHANGED),
      known("b", {}, CHANGED),
      known("c", {}, ["src/x.ts"]),
    ]);
    expect(count(text, "src/a.ts, src/b.ts")).toBe(1);
    expect(text).toContain(
      "      its imports include files changed here since this session started: src/x.ts\n",
    );
    expect(text).toContain(
      "\n\n2 of the 3 failing tests import files changed here since this session started: src/a.ts, src/b.ts\n\n`squeal retry",
    );
  });
});

describe("a group block that states its paths once already (row 005-92)", () => {
  it("keeps them in its block when no other block states them", () => {
    const one = { ...failure("a", CHANGED), summary: "boom" };
    const two = { ...one, check: { ...one.check, fullName: "b" } };
    const text = formatDelta(delta([one, two]));
    expect(text).toContain("FAIL  2 checks with one error and location");
    expect(text).toContain(
      "      its imports include files changed here since this session started: src/a.ts, src/b.ts\n",
    );
    expect(text).not.toContain("failing tests import");
  });

  it("counts as one block beside a single failure, and the line counts the checks", () => {
    const one = { ...failure("a", CHANGED), summary: "boom" };
    const two = { ...one, check: { ...one.check, fullName: "b" } };
    const text = formatDelta(delta([one, two, failure("c", CHANGED)]));
    expect(count(text, "src/a.ts, src/b.ts")).toBe(1);
    expect(text).toContain("All 3 failing tests import files changed here");
  });
});
