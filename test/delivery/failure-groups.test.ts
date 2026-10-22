import { describe, expect, it } from "vitest";
import { formatDelta, MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import type {
  Delta,
  DeltaEntry,
  StatusHeader,
  TransitionEntry,
} from "../../src/core/types/index.js";

// Row 011-109 (gh-71, digest 2026-10-22 group D): failing checks that state one first error and
// location read as one block, with their count and one `squeal failures` command, in every
// harness's notice and deny reason, since each of them is `formatDelta`'s text.

const header: StatusHeader = {
  revision: 12,
  counts: { current: 300, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: 10 },
};

const delta = (entries: DeltaEntry[]): Delta => ({
  schemaVersion: 1,
  consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
  header,
  label: "transitions",
  entries,
});

const RESIZE = "ReferenceError: ResizeObserver is not defined";
/** What the command selects beside the paths (review 0.1.262 B1). */
const SELECTS = `--error "${RESIZE}" --per-check --limit all`;
const CHART = { path: "src/components/chart.tsx", line: 12, column: 5 };

function failure(
  path: string,
  name: string,
  overrides: Partial<TransitionEntry> = {},
): TransitionEntry {
  return {
    check: { kind: "test", project: "", testPath: path, fullName: name },
    kind: "pass-to-fail",
    from: "pass",
    to: "fail",
    validity: "current",
    observedAt: 12,
    origin: { kind: "own" },
    summary: RESIZE,
    location: CHART,
    testFileFrame: { path, line: 20, column: 3 },
    ...overrides,
  };
}

/** `count` failures spread over `files` test files under `dir`, the first file holding the most. */
function spread(count: number, files: number, dir = "tests/components"): TransitionEntry[] {
  return Array.from({ length: count }, (_, i) =>
    failure(`${dir}/f${Math.min(i % (files + 3), files - 1)}.test.tsx`, `renders case ${i}`),
  );
}

/** The blocks of a delta's text after its header: each starts with its outcome. */
const blocks = (text: string) =>
  text
    .split("\n\n")
    .slice(1)
    .filter((b) => /^(?:FAIL|PASS|UNKNOWN|RESOLVED) {2}/.test(b));

describe("a regression notice groups checks with one error and location (row 011-109)", () => {
  it("gives 91 checks that share their first error one block with their count", () => {
    const text = formatDelta(delta(spread(91, 7)));
    const [group, ...rest] = blocks(text);
    expect(rest).toEqual([]);
    expect(group).toBe(
      [
        "FAIL  91 checks with one error and location (91 tests)",
        "      PASS -> FAIL, seen by Squeal's run at revision 12",
        `      ${RESIZE}`,
        "      at src/components/chart.tsx:12:5",
        "      36 tests in tests/components/f6.test.tsx",
        "      10 tests in tests/components/f0.test.tsx",
        "      9 tests in tests/components/f1.test.tsx",
        "      9 tests in tests/components/f2.test.tsx",
        "      9 tests in tests/components/f3.test.tsx",
        "      9 tests in tests/components/f4.test.tsx",
        "      9 tests in tests/components/f5.test.tsx",
        `      Full list: squeal failures tests/components ${SELECTS}`,
      ].join("\n"),
    );
    // The error once in its line, and once as what the command selects.
    expect(text.split(RESIZE)).toHaveLength(3);
    expect(text.match(/squeal failures/g)).toHaveLength(1);
    expect(text).not.toContain("Not shown");
    expect(text.split("\n")[0]).toBe("SQUEAL · 91 checks changed (91 tests) at revision 12");
    expect(text.split("\n").at(-1)).toBe(
      'Full output: squeal why "tests/components/f0.test.tsx > renders case 0"',
    );
  });

  it("gives mixed errors one block each, in the order their first check came", () => {
    const other = (i: number) =>
      failure(`tests/api/a${i}.test.ts`, `posts ${i}`, {
        summary: "TypeError: fetch failed",
        location: { path: "src/api.ts", line: 3, column: 9 },
      });
    const alone = failure("tests/api/z.test.ts", "alone", { summary: "expected 1 to be 2" });
    const entries = [other(0), ...spread(91, 7), alone, other(1), other(2)];
    const heads = blocks(formatDelta(delta(entries))).map((b) => b.split("\n")[0]);
    expect(heads).toEqual([
      "FAIL  3 checks with one error and location (3 tests)",
      "FAIL  91 checks with one error and location (91 tests)",
      "FAIL  tests/api/z.test.ts > alone",
    ]);
  });

  it("names up to five checks one by one and the files they are in", () => {
    const text = formatDelta(
      delta([failure("tests/a.test.ts", "one"), failure("tests/b.test.ts", "two")]),
    );
    expect(blocks(text)).toEqual([
      [
        "FAIL  2 checks with one error and location (2 tests)",
        "      PASS -> FAIL, seen by Squeal's run at revision 12",
        `      ${RESIZE}`,
        "      at src/components/chart.tsx:12:5",
        "      tests/a.test.ts > one",
        "      tests/b.test.ts > two",
        `      Full list: squeal failures tests/a.test.ts tests/b.test.ts ${SELECTS}`,
      ].join("\n"),
    ]);
  });

  it("keeps a line every check shares and leaves out one that differs", () => {
    const shared = { path: "tests/a.test.ts", line: 20, column: 3 };
    const closure = { changesInClosure: ["src/components/chart.tsx"] };
    const same = formatDelta(
      delta([
        failure("tests/a.test.ts", "one", { testFileFrame: shared, ...closure }),
        failure("tests/a.test.ts", "two", { testFileFrame: shared, ...closure }),
      ]),
    );
    expect(same).toContain(
      "      at src/components/chart.tsx:12:5, called from tests/a.test.ts:20:3\n" +
        "      its closure reads files changed here since this session started: src/components/chart.tsx\n",
    );
    const differ = formatDelta(
      delta([
        failure("tests/a.test.ts", "one", closure),
        failure("tests/b.test.ts", "two", { changesInClosure: [] }),
      ]),
    );
    expect(differ).toContain(
      "      at src/components/chart.tsx:12:5\n      tests/a.test.ts > one\n",
    );
    expect(differ).not.toContain("called from");
    expect(differ).not.toContain("closure");
  });

  it("splits checks whose change, run or validity reads differently", () => {
    const entries = [
      failure("tests/a.test.ts", "one"),
      failure("tests/a.test.ts", "two"),
      failure("tests/a.test.ts", "first", { kind: "first-seen-fail", from: null }),
      failure("tests/a.test.ts", "pending", { validity: "pending", observedAt: 11 }),
      failure("tests/a.test.ts", "flaky", {
        flaky: {
          from: "pass",
          to: "fail",
          key: "k",
          fromWorktreeId: "wt",
          toWorktreeId: "wt",
          at: 1,
        } as never,
      }),
      failure("tests/a.test.ts", "no location", { location: null }),
      failure("tests/a.test.ts", "no summary", { summary: null }),
      failure("tests/a.test.ts", "no summary either", { summary: null }),
    ];
    const heads = blocks(formatDelta(delta(entries))).map((b) => b.split("\n")[0]);
    expect(heads).toEqual([
      "FAIL  2 checks with one error and location (2 tests)",
      "FAIL  tests/a.test.ts > first",
      "FAIL  tests/a.test.ts > pending",
      "FAIL  tests/a.test.ts > flaky",
      "FAIL  tests/a.test.ts > no location",
      "FAIL  tests/a.test.ts > no summary",
      "FAIL  tests/a.test.ts > no summary either",
    ]);
  });

  it("states the loads a group of timeouts ran under", () => {
    const timeout = (name: string, loadAverage: number) =>
      failure("tests/slow.test.ts", name, {
        summary: "Hook timed out in 10000ms.",
        location: { path: "tests/setup.ts", line: 4, column: 1 },
        loadAverage,
      });
    const text = (loads: number[]) =>
      formatDelta(delta(loads.map((l, i) => timeout(`case ${i}`, l))));
    expect(text([3.2, 3.2])).toContain("\n      load average 3.20 when they ran\n");
    expect(text([24.36, 3.2, 8])).toContain("\n      load average 3.20 to 24.36 when they ran\n");
  });

  it("selects the group's error and all of its checks once, in its test files, their directory, or every one", () => {
    const command = (entries: TransitionEntry[], cli?: string) =>
      /^ {6}Full list: (.*)$/m.exec(formatDelta(delta(entries), cli))?.[1];
    const odd = "tests/it's here.test.ts";
    expect(
      command([failure("tests/a.test.ts", "one"), failure(odd, "two")], "/opt/squeal/bin/squeal"),
    ).toBe(`/opt/squeal/bin/squeal failures tests/a.test.ts "tests/it's here.test.ts" ${SELECTS}`);
    expect(command(spread(20, 4, "tests/ui"))).toBe(`squeal failures tests/ui ${SELECTS}`);
    expect(command([...spread(4, 4, "tests/ui"), ...spread(4, 4, "tests/api")])).toBe(
      `squeal failures tests ${SELECTS}`,
    );
    expect(command([...spread(4, 4, "web/tests"), ...spread(4, 4, "api/tests")])).toBe(
      `squeal failures ${SELECTS}`,
    );
  });

  it("selects inherited checks in every worktree, by the first line of their error", () => {
    const command = (entries: TransitionEntry[]) =>
      /^ {6}Full list: (.*)$/m.exec(formatDelta(delta(entries)))?.[1];
    const origin = { kind: "inherited", worktreeId: "wt-b", commit: "abc123" } as const;
    expect(
      command([
        failure("tests/a.test.ts", "one", { origin }),
        failure("tests/b.test.ts", "two", { origin }),
      ]),
    ).toBe(`squeal failures tests/a.test.ts tests/b.test.ts ${SELECTS} --all-worktrees`);
    // A part of the error selects as the whole of it does: its first line, at most 120 characters.
    const summary = `Error: $HOME is "${"y".repeat(200)}"\n- expected\n+ received`;
    expect(
      command([
        failure("tests/a.test.ts", "one", { summary }),
        failure("tests/a.test.ts", "two", { summary }),
      ]),
    ).toBe(
      `squeal failures tests/a.test.ts --error 'Error: $HOME is "${"y".repeat(103)}' --per-check --limit all`,
    );
  });

  it(`stays under ${MESSAGE_CAP_CHARS} characters with many groups`, () => {
    const entries = Array.from({ length: 2_000 }, (_, i) =>
      failure(`tests/f${i % 40}.test.ts`, `case ${i}`, {
        summary: `Error ${i % 100}: ${"x".repeat(280)}`,
      }),
    );
    const text = formatDelta(delta(entries));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    const shown = blocks(text).length;
    expect(shown).toBeGreaterThan(5);
    expect(shown).toBeLessThan(100);
    expect(text).toContain(`Not shown: ${2_000 - shown * 20} more changed checks (`);
  });
});
