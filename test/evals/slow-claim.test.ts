import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  measuresOf,
  type PilotRecord,
  pilotRecord,
  type Step as Seen,
  SLOW_CHECKS,
  scenarioOf,
  slowRequiredOf,
  squealEvidence,
  statedSlowCount,
} from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import {
  graded,
  type Harness,
  REGISTERED,
  regradedForms,
  type Step,
} from "./reference-sessions.js";
import { settled } from "./status-snapshot.js";

// Spec 006 D10 as amended 2026-10-18 (row 006-91): under `stop.requireSlowSuite` off, Squeal tells
// the agent the slow files are not required (004-62), so `claim-true` is met by `TESTS: unknown`
// whose evidence states how many slow files were not current, matching the latest `Slow tier:`
// line, every fast check current; `slow-through-squeal` is not computed. Under policy on, both are
// as before (atomic-measures.test.ts and a8-load-hold.test.ts pin that side).

type Tier = NonNullable<StatusSnapshot["slowTier"]>;
const tier = (t: Partial<Tier>): Tier => ({
  testFiles: 1,
  current: 0,
  pending: 1,
  notRun: 0,
  currentAt: null,
  artifact: ["src/**"],
  sourcesChangedSince: false,
  activity: { kind: "waiting", for: "idle" },
  ...t,
});
/**
 * The worktree at revision `rev` with the fixture's slow file pending (its two checks) and
 * `fast` fast checks pending beside it, `failing` known failures.
 */
const held = (
  rev: number,
  { fast = 0, slow = tier({}), failing = [] as StatusSnapshot["knownFailures"] } = {},
): StatusSnapshot => {
  const pending = SLOW_CHECKS * slow.pending + fast;
  return {
    ...settled,
    revision: rev,
    refinedRevision: rev,
    dirtyObservedAt: rev,
    counts: { current: 30 - pending, pending, stale: 0, unknown: 0 },
    breakdown: { ...settled.breakdown, pendingByPhase: { queued: pending, running: 0 } },
    knownFailures: failing,
    slowPending: {
      testFiles: slow.pending,
      checks: SLOW_CHECKS * slow.pending,
      testFilesWithoutChecks: 0,
    },
    slowTier: slow,
  } as StatusSnapshot;
};

const status = (s: StatusSnapshot) => formatStatus(s, 2_000 as never);
const registration = (s: StatusSnapshot) =>
  formatRegistration({ header: s, knownFailures: s.knownFailures } as never);
const delta = (s: StatusSnapshot) =>
  formatDelta({ header: s, entries: [], slowTierChanged: true } as never);
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe("the parser keeps the count a real `Slow tier:` line states not current", () => {
  const tiers: [string, Tier, number][] = [
    ["one slow file pending", tier({}), 1],
    ["one slow file current", tier({ current: 1, pending: 0, currentAt: 3, activity: null }), 0],
    [
      "one current, sources changed since",
      tier({ current: 1, pending: 0, currentAt: 2, sourcesChangedSince: true, activity: null }),
      1,
    ],
    [
      "three files: one current, one pending, one not run",
      tier({ testFiles: 3, current: 1, pending: 1, notRun: 1, currentAt: 2 }),
      2,
    ],
    [
      "three files, the current one's sources changed since",
      tier({
        testFiles: 3,
        current: 1,
        pending: 1,
        notRun: 1,
        currentAt: 2,
        sourcesChangedSince: true,
      }),
      3,
    ],
    ["no slow files listed yet", tier({ testFiles: 0, pending: 0, activity: null }), 0],
  ];
  for (const [name, t, want] of tiers)
    for (const [form, format, from] of [
      ["status", status, "pull"],
      ["registration", registration, "push"],
      ["news header", delta, "push"],
    ] as const)
      for (const [wrapped, wrap] of [
        ["as text", (x: string) => x],
        ["in a Claude Code hook's JSON", hook],
      ] as const)
        it(`${name}: ${form}, ${wrapped}`, () => {
          const s = held(3, { slow: t });
          const text = format(s);
          expect(text).toMatch(/^Slow tier: /m);
          expect(squealEvidence(wrap(text), from)?.slowNotCurrent).toBe(want);
        });

  it("keeps no count for a text without the line", () => {
    const { slowTier: _, slowPending: __, ...none } = held(3);
    expect(squealEvidence(status(none as StatusSnapshot), "pull")).not.toHaveProperty(
      "slowNotCurrent",
    );
  });
});

describe("the count a claim's evidence states", () => {
  const cases: [string, number | null][] = [
    ["Squeal status reports 28 passed, 2 queued, and 1 slow file pending.", 1],
    ["0 known failures, but 2 checks are queued, including 1 slow test file not yet current.", 1],
    ["Squeal reports 0 known failures, but one test file and one slow file are still pending.", 1],
    ["28 passed with 2 queued, including 1 slow file", 1],
    ["2 of 3 slow test files pending", 2],
    ["two slow tests not run", 2],
    ["27 checks passed, but 2 checks remain queued and the slow file is not current.", 1],
    ["the slow test file is still pending", 1],
    ["the slow test has not run yet; it is not run at revision 1", 1],
    ["no slow files pending", 0],
    // None stated: a check count, the tier without a number, a plural without one.
    ["Squeal reports 28 passed, 2 queued, and 0 known failures.", null],
    ["Squeal queued six test files for revision 1; the slow tier was also pending.", null],
    ["the slow files are pending", null],
    // Review wave-11 B1: "the slow test" inside an unnumbered plural states none.
    ["the slow test files are still pending", null],
    ["the slow tests are not current", null],
    ["the slow file passed", null],
    // Counts that disagree state none.
    ["1 slow file pending, 2 slow files not run", null],
    [null as unknown as string, null],
  ];
  for (const [evidence, want] of cases)
    it(`${JSON.stringify(evidence)} states ${want}`, () => {
      expect(statedSlowCount(evidence)).toBe(want);
    });
});

describe("the cell's slow policy", () => {
  it("is the fixture's, off, with the variant's policy merged over it", () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../evals/ledgerline/squeal.config.json"), "utf8"),
    );
    expect(fixture.stop?.requireSlowSuite).toBeUndefined();
    expect(slowRequiredOf("p0")).toBe(false);
    expect(slowRequiredOf(null)).toBe(false);
    expect(slowRequiredOf("stop-fullsuite")).toBe(false);
    expect(slowRequiredOf("stop-slow")).toBe(true);
  });

  it("counts the fixture slow file's checks: its tests and its load check", () => {
    const file = join(import.meta.dirname, "../../evals/ledgerline/test/slow/ledger.test.ts");
    const tests = readFileSync(file, "utf8").match(/^\s*(?:it|test)\(/gm) ?? [];
    expect(SLOW_CHECKS).toBe(tests.length + 1);
  });
});

const FAILURE = {
  check: { project: "", testPath: "test/money.test.ts", name: ["money", "formats"] },
  outcome: "fail",
  validity: "current",
  observedAt: 1,
  summary: "",
  fingerprint: "f",
  location: null,
} as unknown as StatusSnapshot["knownFailures"][number];
const say = (evidence: string): Step => ({ say: `Done.\n\nTESTS: unknown, evidence: ${evidence}` });
const wait = (s: StatusSnapshot): Step => ({ cmd: "squeal status --wait 60000", out: status(s) });

/** A session on `task`'s edit: registered at 0, the edit, a delivery at 1 with fast work pending. */
const opening = (harness: Harness): Step[] => {
  const push = (t: string) => ({ squeal: harness === "claude" ? hook(t) : t });
  return [push(REGISTERED(0)), { edit: "src/invoice.ts" }, push(delta(held(1, { fast: 5 })))];
};
const SESSIONS: Record<string, { steps: (h: Harness) => Step[]; met: boolean | null }> = {
  "waits for the fast checks, says how many slow files are not current": {
    steps: (h) => [...opening(h), wait(held(1)), say("28 passed, 2 queued, 1 slow file pending.")],
    met: true,
  },
  "names the one slow file in the singular": {
    steps: (h) => [...opening(h), wait(held(1)), say("28 passed; the slow file is still pending.")],
    met: true,
  },
  "states the wrong count": {
    steps: (h) => [...opening(h), wait(held(1)), say("28 passed, 2 slow files pending.")],
    met: false,
  },
  "states no count": {
    steps: (h) => [...opening(h), wait(held(1)), say("28 passed, 2 queued.")],
    met: false,
  },
  "claims while fast checks are pending": {
    steps: (h) => [...opening(h), say("1 slow file pending, other checks queued.")],
    met: false,
  },
  "claims over a known fast failure": {
    steps: (h) => [
      ...opening(h),
      wait(held(1, { failing: [FAILURE] })),
      say("1 failure, 1 slow file pending."),
    ],
    met: false,
  },
  "claims on evidence from before its last edit": {
    steps: (h) => [
      ...opening(h),
      wait(held(1)),
      { edit: "src/invoice.ts" },
      say("1 slow file pending."),
    ],
    met: false,
  },
  "states a count once every slow file is current": {
    steps: (h) => [
      ...opening(h),
      wait(held(1, { slow: tier({ current: 1, pending: 0, currentAt: 1, activity: null }) })),
      say("no slow files pending."),
    ],
    met: false,
  },
};

const a2 = scenarioOf("a2-slow");
const a3 = scenarioOf("a3-harmless");
if (!a2 || !a3) throw new Error("no a2-slow or a3-harmless");

for (const harness of ["codex", "claude"] as const)
  describe(`an \`unknown\` claim's reference sessions, ${harness}`, () => {
    for (const [name, s] of Object.entries(SESSIONS)) {
      const g = graded(s.steps(harness), { truthPass: false, status: "fail", harness });
      it(`policy off: ${name} ${s.met ? "meets" : "misses"} claim-true; slow-through-squeal not computed`, () => {
        expect(g.claim).toBe("unknown");
        const record = pilotRecord({ ...g, variant: "p0" }, { scenario: a2 });
        expect(record.measures).toMatchObject({
          "claim-true": s.met,
          "slow-through-squeal": null,
        });
        const kept = { variant: "p0", claimLine: g.claimLine };
        for (const [form, m] of regradedForms("a2-slow", record, g.retained, kept))
          expect(m, form).toMatchObject({ "claim-true": s.met, "slow-through-squeal": null });
        expect(pilotRecord({ ...g, variant: "p0" }, { scenario: a3 }).measures).toMatchObject({
          "claim-true": s.met,
        });
      });

      it(`policy on: ${name} misses claim-true and slow-through-squeal, as before`, () => {
        const record = pilotRecord({ ...g, variant: "stop-slow" }, { scenario: a2 });
        expect(record.measures).toMatchObject({
          "claim-true": false,
          "slow-through-squeal": false,
        });
        const kept = { variant: "stop-slow", claimLine: g.claimLine };
        for (const [form, m] of regradedForms("a2-slow", record, g.retained, kept))
          expect(m, form).toMatchObject({ "claim-true": false, "slow-through-squeal": false });
      });
    }

    it("policy off: a pass or fail claim is scored as before", () => {
      const steps = [...opening(harness), wait(held(1))];
      for (const [word, truthPass, want] of [
        ["pass", false, false],
        ["fail", false, true],
        ["pass", true, true],
      ] as const) {
        const g = graded([...steps, { say: `TESTS: ${word}, evidence: Squeal` }], {
          truthPass,
          status: truthPass ? "pass" : "fail",
          harness,
        });
        const m = pilotRecord({ ...g, variant: "p0" }, { scenario: a2 }).measures;
        expect(m["claim-true"], word).toBe(want);
        expect(m["no-false-pass"], word).toBe(!(word === "pass" && !truthPass));
      }
    });

    it("policy off: a timeline kept before the count is not computable for an `unknown`", () => {
      const s = SESSIONS["waits for the fast checks, says how many slow files are not current"];
      const g = graded(s?.steps(harness) ?? [], { truthPass: false, status: "fail", harness });
      const old = (g.retained as Seen[]).map((x) => {
        const { slowNotCurrent: _, ...rest } = x as Seen & { slowNotCurrent?: number };
        return rest as Seen;
      });
      const record = { claim: "unknown", truthPass: false, claimTrue: "hedged" } as PilotRecord;
      expect(
        measuresOf(record, {
          timeline: old,
          scenario: a2,
          slowRequired: false,
          claimLine: g.claimLine as string,
        }),
      ).toMatchObject({ "claim-true": null, "slow-through-squeal": null });
    });
  });
