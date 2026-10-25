import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import {
  type EndedNamed,
  type EndedWait,
  type NamedTextOptions,
  namedText,
  waitText,
} from "../../src/cli/status-wait-lines.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { statusText } from "../../src/harness/shared/text.js";
import { squealEvidence as mainEvidence } from "./fixtures/squeal-text-c6320866.mjs";
import { settled } from "./status-snapshot.js";

// D4 "Retained evidence": the evidence a Squeal text carries, read from the product's own
// wording (`squeal status` and a delivered header), so a change to that wording shows here.

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const header = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const stop = (s: StatusSnapshot) => statusText(s, s.knownFailures);
/**
 * A change delivery's header, the news form from 001-407 on: non-zero counts only. It carries
 * the slow-tier line when the slow tier changed, as it does here.
 */
const news = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], slowTierChanged: true } as never);
/**
 * Row 011-205: the first change delivery after the listing to a consumer registered before it,
 * the full counts once, with why a lookup-only baseline queued no test file without checks.
 */
const owedNews = (s: StatusSnapshot) =>
  formatDelta({
    header: s,
    entries: [],
    slowTierChanged: true,
    countsOwed: { lookupOnly: true },
  } as never);
/** A Claude Code hook's reply, Squeal's text inside, as a cell keeps it. */
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });
const failure = {
  check: { project: "", testPath: "test/money.test.ts", name: ["money", "formats"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
} as unknown as StatusSnapshot["knownFailures"][number];
const withoutChecks = (pending: number, unknown: number): StatusSnapshot => ({
  ...settled,
  testFilesWithoutChecks: { pending, unknown },
  // Row 011-26: the test files by class, as `readHeader` counts them.
  testFileCounts: { current: 6 - pending - unknown, pending, stale: 0, unknown },
  testFilesByPhase: { running: 0, queued: pending },
  breakdown: { ...settled.breakdown, testFilesWithoutChecks: pending + unknown },
});
const slowPending: StatusSnapshot = {
  ...settled,
  slowTier: {
    testFiles: 1,
    current: 0,
    pending: 1,
    notRun: 0,
    currentAt: null,
    activity: null,
  },
};
/** The slow tier current at revision 2 (004-81: no artifact or source change is named). */
const slowCurrent = (): StatusSnapshot => ({
  ...settled,
  slowTier: {
    testFiles: 1,
    current: 1,
    pending: 0,
    notRun: 0,
    currentAt: 2,
    activity: null,
  },
});
const variants: [string, StatusSnapshot, object][] = [
  ["settled", settled, { verdict: "pass" }],
  [
    "pending",
    {
      ...settled,
      counts: { ...settled.counts, pending: 2 },
      testFileCounts: { current: 4, pending: 2, stale: 0, unknown: 0 },
      testFilesByPhase: { running: 1, queued: 1 },
      testsByPhase: { running: 1, queued: 1 },
      breakdown: { ...settled.breakdown, pendingByPhase: { queued: 1, running: 1 } },
    },
    { verdict: "unknown" },
  ],
  [
    "stale and unknown",
    {
      ...settled,
      counts: { ...settled.counts, stale: 1, unknown: 1 },
      testFileCounts: { current: 4, pending: 0, stale: 1, unknown: 1 },
    },
    { verdict: "unknown" },
  ],
  [
    "known failure",
    { ...settled, knownFailures: [failure] },
    { failures: 1, verdict: "fail", failing: ["test/money.test.ts"] },
  ],
  [
    "no daemon",
    { ...settled, daemon: { state: "down", since: null } } as unknown as StatusSnapshot,
    { daemon: false, verdict: "unknown" },
  ],
  // Review 001-423, B2: `squeal status` ends this sentence with its line, not a period.
  ["1 pending test file without checks", withoutChecks(1, 0), { verdict: "unknown" }],
  ["1 unknown test file without checks", withoutChecks(0, 1), { verdict: "unknown" }],
  ["1 pending and 1 unknown test file without checks", withoutChecks(1, 1), { verdict: "unknown" }],
  ["slow tier pending", slowPending, { slow: false, verdict: "unknown" }],
  ["slow tier current", slowCurrent(), { slow: true, verdict: "pass" }],
];

/** The pending, stale and unknown counts a snapshot holds, test files without checks included. */
const countsOf = (s: StatusSnapshot) => ({
  pending: s.counts.pending + s.testFilesWithoutChecks.pending,
  stale: s.counts.stale,
  unknown: s.counts.unknown + s.testFilesWithoutChecks.unknown,
});
/**
 * Row 011-29: the counts status's default text gives. It has no `Test files without checks:`
 * line, so while its `Known failures:` clause says what is not current, they are the clause's,
 * its test files and its tests by class; else the snapshot's.
 */
const statusCounts = (s: StatusSnapshot) => {
  const files = s.testFileCounts;
  const tests = (v: "pending" | "stale" | "unknown") => s.counts[v] - (s.fileLevelCounts?.[v] ?? 0);
  if (files === undefined || files.pending + files.stale + files.unknown === 0) return countsOf(s);
  return {
    pending: files.pending + tests("pending"),
    stale: files.stale + tests("stale"),
    unknown: files.unknown + tests("unknown"),
  };
};
/**
 * `s` with its pending slow files among its test files' counts, as `readHeader` counts every
 * listed file (row 011-26); `slowPending` above leaves them out.
 */
const slowCounted = (s: StatusSnapshot): StatusSnapshot => {
  const slow = s.slowTier?.pending ?? 0;
  const files = s.testFileCounts;
  if (slow === 0 || files === undefined) return s;
  return {
    ...s,
    testFileCounts: { ...files, current: files.current - slow, pending: files.pending + slow },
    testFilesByPhase: { running: 0, queued: (s.testFilesByPhase?.queued ?? 0) + slow },
  };
};
/** Whether anything in the snapshot is pending, stale or unknown, the slow tier included. */
const owes = (s: StatusSnapshot) =>
  Object.values(countsOf(s)).some((n) => n > 0) || (s.slowTier?.pending ?? 0) > 0;

const formatters = [
  ["status", status, "pull"],
  ["registration's header", header, "push"],
  // Row 011-26: Stop's status text, its `Known failures:` line naming the failures and what is
  // not current.
  ["Stop's status text", stop, "push"],
  ["change delivery's news header (task 001-407)", news, "push"],
  ["change delivery's news header owed the counts (row 011-205)", owedNews, "push"],
] as const;
const wrappings = [
  ["as text", (t: string) => t],
  ["in a Claude Code hook's JSON", hook],
] as const;

const down = (s: StatusSnapshot) => s.daemon?.state === "down";
/** `status --wait`'s text as the command prints it: the snapshot, then last its verdict (011-10). */
const wait = (s: StatusSnapshot) =>
  waitText(
    {
      outcome: down(s) ? "no-daemon" : "quiet",
      waitedMs: 1_000,
      transitions: 0,
      result: s,
    } as EndedWait,
    2_000 as never,
  );
/**
 * `status --wait <ms> <path>`'s text on the money test file, settled, its verdict last (011-10):
 * from row 011-28 the revision line and the selection, the worktree's status only with `--full`.
 */
const named = (s: StatusSnapshot, how: NamedTextOptions = {}, snapshot = false) =>
  namedText(
    {
      outcome: down(s) ? "no-daemon" : "settled",
      waitedMs: 1_000,
      selection: { files: [{ project: "", path: "test/money.test.ts" }], unmatched: [] },
      verdict: {
        revision: 3,
        testFiles: 1,
        byClass: { current: 1, pending: 0, stale: 0, unknown: 0 },
        unlisted: false,
        failures: { tests: s.knownFailures.length, testFiles: 0 },
      },
      files: [{ testFile: { project: "", path: "test/money.test.ts" }, state: "current" }],
      sync: { state: "synced", revision: 3 },
      result: s,
      ...(snapshot ? { snapshot: true } : {}),
    } as unknown as EndedNamed,
    2_000 as never,
    "squeal",
    how,
  );
/** Row 011-28: `status <path>`, the same answer from one read, worded as a snapshot. */
const snapshotNamed = (s: StatusSnapshot) => named(s, {}, true);
/**
 * Row 011-12 (011 C15): a named wait that timed out lists the selected files by class before
 * its verdict, each pending one with what holds it and each current one with its verdict.
 */
const timedOut = (s: StatusSnapshot, how: NamedTextOptions = {}) =>
  namedText(
    {
      outcome: down(s) ? "no-daemon" : "timeout",
      waitedMs: 1_000,
      selection: {
        files: ["a", "b", "c", "d"].map((n) => ({ project: "", path: `test/${n}.test.ts` })),
        unmatched: [],
      },
      verdict: {
        revision: 3,
        testFiles: 4,
        byClass: { current: 1, pending: 2, stale: 0, unknown: 1 },
        unlisted: false,
        failures: { tests: s.knownFailures.length, testFiles: 0 },
      },
      files: [
        { testFile: { project: "", path: "test/a.test.ts" }, state: "current", verdict: "pass" },
        {
          testFile: { project: "", path: "test/b.test.ts" },
          state: "pending",
          pending: { kind: "running", lane: "vitest", since: 1_000 },
        },
        {
          testFile: { project: "", path: "test/c.test.ts" },
          state: "pending",
          pending: { kind: "queued", lane: "vitest", behind: 1_000 },
        },
        {
          testFile: { project: "", path: "test/d.test.ts" },
          state: "unknown",
          unknown: {
            testFile: { project: "", path: "test/d.test.ts" },
            ran: false,
            reason: "never run at this key, and nothing queued it",
            samples: [],
          },
        },
      ],
      sync: { state: "synced", revision: 3 },
      result: s,
    } as unknown as EndedNamed,
    2_000 as never,
    "squeal",
    how,
  );
/** The named forms as an agent runs them, short from row 011-28 (005 D2 as amended 2026-10-20). */
const shortNamed = [
  ["status --wait <ms> <path>", named],
  ["timed-out status --wait <ms> <path>", timedOut],
  ["status <path>", snapshotNamed],
] as const;
/** What a text says of the worktree, apart from the files it credits. */
const worktree = (e: ReturnType<typeof squealEvidence>) => {
  const { revision, pending, stale, unknown, slow, daemon, known, failures, verdict } = e ?? {};
  return { revision, pending, stale, unknown, slow, daemon, known, failures, verdict };
};

describe("squealEvidence", () => {
  for (const [name, s, want] of variants)
    for (const [form, format, from] of formatters)
      for (const [wrapped, wrap] of wrappings)
        it(`reads a ${name} ${form}, ${wrapped}`, () => {
          const { failing, ...rest } = want as { failing?: string[] };
          const known = form === "status" ? 0 : s.knownFailures.length;
          const e = squealEvidence(wrap(format(s)), from, known);
          expect(e).toMatchObject({
            revision: 3,
            ...(form === "status" ? statusCounts(s) : countsOf(s)),
            ...rest,
            ...(form === "status" && failing ? { failing } : {}),
          });
          if (owes(s)) expect(e?.verdict).not.toBe("pass");
          // Review 001-423, B2: never more permissive than main's parser before 001-407, which
          // reads no news header, so a news header is held to its reading of the full one.
          const base = mainEvidence(wrap((form === "status" ? status : header)(s)), from, known);
          if (e?.verdict === "pass") expect(base?.verdict).toBe("pass");
          for (const count of ["pending", "stale", "unknown"] as const)
            if (typeof base?.[count] === "number")
              expect(e?.[count], count).toBeGreaterThanOrEqual(base[count]);
        });

  // Row 011-10 (issue 26): a wait prints its verdict last, after the snapshot; its text says of
  // the worktree what the status it prints says, as text and in a hook's JSON (review wave-1.9
  // S1). Row 011-12: so does a named wait that lists the selected files by class; from row
  // 011-28 a named wait prints the status only with `--full`, and from row 011-29 that status is
  // the full text (review of cand/0.1.234).
  const full = (s: StatusSnapshot) => formatStatus(s, 2_000 as never, "squeal", { full: true });
  for (const [name, s] of variants)
    for (const [form, format, printed] of [
      ["status --wait", wait, status],
      ["status --wait --full <ms> <path>", (t: StatusSnapshot) => named(t, { full: true }), full],
      [
        "timed-out status --wait --full <ms> <path>",
        (t: StatusSnapshot) => timedOut(t, { full: true }),
        full,
      ],
    ] as const)
      for (const [wrapped, wrap] of wrappings)
        it(`reads a ${name} ${form} as the status it prints, ${wrapped}`, () => {
          const text = format(s);
          expect(text.startsWith(printed(s))).toBe(true);
          expect(worktree(squealEvidence(wrap(text), "pull"))).toEqual(
            worktree(squealEvidence(wrap(printed(s)), "pull")),
          );
        });

  // Row 011-26 (011 C6 as amended 2026-10-20, gh-45): a wait's verdict line alone, as a `tail -1`
  // keeps it, says through its not-current clause whether anything is not current, as the status
  // it ends does.
  const notCurrent = (e: { pending?: unknown; stale?: unknown; unknown?: unknown } | null) =>
    [e?.pending, e?.stale, e?.unknown].some((n) => typeof n === "number" && n > 0);
  for (const [name, s] of variants)
    for (const [form, format] of [["status --wait", wait], ...shortNamed] as const)
      for (const [wrapped, wrap] of wrappings)
        it(`reads what is not current from a ${name} ${form}'s verdict line alone, ${wrapped}`, () => {
          const line = format(s).trimEnd().split("\n").at(-1) ?? "";
          const e = squealEvidence(wrap(line), "pull");
          expect(e?.pending).toEqual(expect.any(Number));
          expect(notCurrent(e)).toBe(notCurrent(countsOf(s)));
          if (notCurrent(countsOf(s))) expect(e?.verdict).not.toBe("pass");
        });

  // Row 011-28 (gh-44): a named wait's short text, the revision line, the selection and its
  // verdict, says of the worktree through its verdict line's clause what the status says: its
  // revision, its known failures, whether a daemon validates, and the same verdict. The clause
  // counts every listed test file, slow ones too, as `readHeader` does (`slowCounted`).
  for (const [name, s] of variants)
    for (const [form, format] of shortNamed)
      for (const [wrapped, wrap] of wrappings)
        it(`reads a ${name} ${form}'s short text as the worktree's status, ${wrapped}`, () => {
          const t = slowCounted(s);
          const text = format(t);
          expect(text).toMatch(/^Revision: 3\n/);
          expect(text).not.toContain("Affected checks:");
          const e = squealEvidence(wrap(text), "pull");
          const full = squealEvidence(wrap(status(t)), "pull");
          expect(e).toMatchObject({ revision: 3, daemon: full?.daemon, known: full?.known });
          expect(e?.verdict).toBe(full?.verdict);
          expect(notCurrent(e)).toBe(owes(t));
        });

  for (const [form, format] of [
    ["status --wait <ms> <path>", named],
    ["status <path>", snapshotNamed],
  ] as const)
    for (const [wrapped, wrap] of wrappings)
      it(`credits the selected file of a ${form} whose verdict prints last, ${wrapped}`, () => {
        const e = squealEvidence(wrap(format({ ...settled, knownFailures: [failure] })), "pull");
        expect(e).toMatchObject({ files: ["test/money.test.ts"], failing: ["test/money.test.ts"] });
        expect(e?.verdict).toBe("fail");
        const clean = squealEvidence(wrap(format(settled)), "pull");
        expect(clean).toMatchObject({ files: ["test/money.test.ts"], verdict: "pass" });
      });

  it("is not current before the daemon listed the test files", () => {
    const e = squealEvidence(header({ ...settled, testFilesListed: false }), "push");
    expect(e?.verdict).toBe("unknown");
  });

  it("tracks failures across deliveries that name only what changed", () => {
    const fail =
      "SQUEAL · 1 check changed at revision 4\nRevision 4: 31 current, 0 pending, 0 stale, 0 unknown.\n\nFAIL  test/a.test.ts > a";
    const pass =
      "SQUEAL · 1 check changed at revision 5\nRevision 5: 31 current, 0 pending, 0 stale, 0 unknown.\n\nPASS  test/a.test.ts > a\n    FAIL -> PASS";
    const failed = squealEvidence(fail, "push", 0);
    expect(failed).toMatchObject({ failures: 1, verdict: "fail", files: ["test/a.test.ts"] });
    expect(squealEvidence(pass, "push", 1)).toMatchObject({ failures: 0, verdict: "pass" });
  });

  it("carries no evidence in a text without a revision or counts", () => {
    expect(squealEvidence("Squeal runs this repository's Vitest tests", "push")).toBeNull();
  });
});
