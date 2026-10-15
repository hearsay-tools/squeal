import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { squealEvidence as mainEvidence } from "./fixtures/squeal-text-c6320866.mjs";
import { settled } from "./status-snapshot.js";

// D4 "Retained evidence": the evidence a Squeal text carries, read from the product's own
// wording (`squeal status` and a delivered header), so a change to that wording shows here.

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const header = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
/**
 * A change delivery's header, the news form from 001-407 on: non-zero counts only. It carries
 * the slow-tier line when the slow tier changed, as it does here.
 */
const news = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], slowTierChanged: true } as never);
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
    artifact: [],
    sourcesChangedSince: false,
    activity: null,
  },
};
const variants: [string, StatusSnapshot, object][] = [
  ["settled", settled, { verdict: "pass" }],
  [
    "pending",
    {
      ...settled,
      counts: { ...settled.counts, pending: 2 },
      breakdown: { ...settled.breakdown, pendingByPhase: { queued: 1, running: 1 } },
    },
    { verdict: "unknown" },
  ],
  [
    "stale and unknown",
    {
      ...settled,
      counts: { ...settled.counts, stale: 1, unknown: 1 },
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
];

/** The pending, stale and unknown counts a snapshot holds, test files without checks included. */
const countsOf = (s: StatusSnapshot) => ({
  pending: s.counts.pending + s.testFilesWithoutChecks.pending,
  stale: s.counts.stale,
  unknown: s.counts.unknown + s.testFilesWithoutChecks.unknown,
});
/** Whether anything in the snapshot is pending, stale or unknown, the slow tier included. */
const owes = (s: StatusSnapshot) =>
  Object.values(countsOf(s)).some((n) => n > 0) || (s.slowTier?.pending ?? 0) > 0;

const formatters = [
  ["status", status, "pull"],
  ["registration's header", header, "push"],
  ["change delivery's news header (task 001-407)", news, "push"],
] as const;
const wrappings = [
  ["as text", (t: string) => t],
  ["in a Claude Code hook's JSON", hook],
] as const;

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
            ...countsOf(s),
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
