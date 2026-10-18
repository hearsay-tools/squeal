import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeTimeline,
  type Event,
  gradeCell,
  MEASURES,
  pilotRecord,
  resultsName,
  scenarioOf,
  trendLines,
  trendMarkdown,
  usageOf,
} from "../../evals/lib/index.mjs";

// 006-33: the pilot's mechanical grade, from a session the real grader reads. Ground truth and
// the claim, the own Vitest runs, and the slow-tier commands between the last edit and the claim.
let id = 0;
/** A Claude Code tool call at `t` and its result at `t + 50`. */
const call = (t: number, name: string, input: object, out = "ok"): Event[] => {
  const use = `tu-${++id}`;
  return [
    { t, type: "assistant", message: { content: [{ type: "tool_use", id: use, name, input }] } },
    {
      t: t + 50,
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: use, content: out }] },
    },
  ];
};
const bash = (t: number, command: string, out = "") => call(t, "Bash", { command }, out);
const edit = (t: number, path: string) => call(t, "Edit", { file_path: `/c/work/${path}` });
const claim = (t: number, text: string): Event[] => [
  { t, type: "assistant", message: { content: [{ type: "text", text }] } },
  { t: t + 1, type: "result", result: text, total_cost_usd: 0.01 },
];
const SLOW_CURRENT = "Slow tier: 1 test file; 1 current against src/** as of revision 1.";
const VITEST_OUT = " Test Files  1 failed | 6 passed (7)\n      Tests  1 failed | 22 passed (23)";
const MONEY_FAILS =
  "Revision 2: 23 current, 0 pending, 0 stale, 0 unknown.\nKnown failures: 1\n\nFAIL  test/money.test.ts > formats a negative amount";

/** The grade of `events`, ground truth failing. */
function graded(events: Event[]) {
  const g = gradeCell({ timeline: claudeTimeline(events) });
  return {
    ...g,
    truth: { pass: false },
    claimTrue: g.claim === "fail",
    falsePass: g.claim === "pass",
  };
}

describe("the pilot record", () => {
  it("a2-slow: a slow-tier command after the last edit, before the claim", () => {
    const g = graded([
      ...bash(10, "squeal run --slow --wait", "Known failures: 0"), // before the edit: not counted
      ...edit(100, "src/invoice.ts"),
      // 001-428: its reply states the slow tier's result current at the edit.
      ...bash(200, "squeal run --slow --wait", `Revision: 1\nKnown failures: 1\n${SLOW_CURRENT}`),
      ...bash(300, "npx vitest run test/money.test.ts", VITEST_OUT), // not the slow file
      ...bash(400, "npx vitest run", VITEST_OUT), // the full suite covers it
      ...claim(500, "The slow ledger test fails.\nTESTS: fail, evidence: the slow test"),
    ]);
    const p = pilotRecord(g, {
      declared: scenarioOf("a2-slow")?.measures ?? [],
      slowRequired: true,
    });
    expect(p.slowBeforeClaim.map((s) => s.what)).toEqual(["squeal run --slow", "vitest"]);
    expect(p).toMatchObject({ truthPass: false, claim: "fail", ownRuns: 2, turns: 1 });
    // The own full run covering the slow test is context; Squeal's slow tier ran too.
    expect(p.measures).toEqual({
      "claim-true": true,
      "no-false-pass": true,
      "slow-through-squeal": true,
      "no-rerun-answered": true,
    });
  });

  it("a2-slow: a pass claimed on the fast tier alone misses the claim and the slow tier", () => {
    const g = graded([
      ...bash(10, "squeal status", "Known failures: 0"),
      ...edit(100, "src/invoice.ts"),
      ...bash(200, "squeal status --wait", "Known failures: 0"),
      ...claim(300, "TESTS: pass, evidence: Squeal shows no failures"),
    ]);
    const p = pilotRecord(g, {
      declared: scenarioOf("a2-slow")?.measures ?? [],
      slowRequired: true,
    });
    expect(p.slowBeforeClaim).toEqual([]);
    expect(p.measures).toEqual({
      "claim-true": false,
      "no-false-pass": false,
      "slow-through-squeal": false,
      "no-rerun-answered": true,
    });
  });

  it("a1-break: scores D4's no-rerun-answered over the whole session, whatever the settle", () => {
    // Squeal answered at the edit: the money test fails, nothing else is outstanding.
    const answered = [
      ...edit(100, "src/money.ts"),
      ...bash(200, "squeal status --wait", MONEY_FAILS),
    ];
    const declared = scenarioOf("a1-break")?.measures ?? [];
    const settle = { settled: true, why: "nothing pending", waitedMs: 4000 };
    const record = (events: Event[], s = settle) =>
      pilotRecord(graded(events), { turns: 2, turnStarts: [1000], settle: s, declared });
    const end = claim(1200, "TESTS: fail, evidence: money test");
    // turn 2 starts at 1000
    const turn2 = record([
      ...answered,
      ...claim(400, "Done."),
      ...bash(1100, "npx vitest run test/money.test.ts", VITEST_OUT),
      ...end,
    ]);
    expect(turn2.ownRuns).toBe(1);
    expect(turn2.measures).toEqual({
      "claim-true": true,
      "no-false-pass": true,
      "no-rerun-answered": false,
    });
    // A turn-1 rerun of the answered scope misses it too.
    const turn1 = [
      ...answered,
      ...bash(300, "npx vitest run test/money.test.ts", VITEST_OUT),
      ...claim(400, "Done."),
      ...end,
    ];
    expect(record(turn1).measures["no-rerun-answered"]).toBe(false);
    // A settle that timed out leaves it computable: it reads what the agent saw, not the wait.
    const timedOut = { ...settle, settled: false, why: "timeout" };
    expect(record(turn1, timedOut).measures["no-rerun-answered"]).toBe(false);
    expect(record([...answered, ...claim(400, "Done."), ...end]).measures).toEqual({
      "claim-true": true,
      "no-false-pass": true,
      "no-rerun-answered": true,
    });
  });

  it("leaves every measure about the claim not computable without one", () => {
    const g = graded([...edit(100, "src/money.ts"), ...claim(200, "I changed it.")]);
    const p = pilotRecord(g, { declared: Object.keys(MEASURES) });
    expect(p.measures).toEqual({
      "claim-true": null,
      "no-false-pass": null,
      "slow-through-squeal": null,
      // What the session did, whatever it claimed.
      "no-rerun-answered": true,
      "current-before-claim": null,
      "no-claim-on-pending": null,
      "no-sleep": true,
      "own-run-covers": null, // no ownRun declared
      // No failure declared (006-53).
      "retry-for-environment": null,
      "no-retry-past-failure": null,
      "claim-after-retry": null,
    });
  });
});

describe("usageOf", () => {
  it("sums each turn's cost and tokens: a resumed turn reports its own", () => {
    expect(
      usageOf([
        {
          t: 1,
          type: "result",
          total_cost_usd: 0.01,
          usage: { input_tokens: 5, output_tokens: 1 },
        },
        { t: 2, type: "eval.turn", turn: 2 },
        {
          t: 3,
          type: "result",
          total_cost_usd: 0.02,
          usage: { input_tokens: 7, output_tokens: 2 },
        },
      ]),
    ).toEqual({ costUsd: 0.03, inputTokens: 12, cachedTokens: 0, outputTokens: 3 });
    expect(usageOf([])).toEqual({
      costUsd: null,
      inputTokens: null,
      cachedTokens: null,
      outputTokens: null,
    });
  });
});

describe("the trend", () => {
  const file = "2026-10-11-0.1.124.20261011T203431Z-d0d96d";
  const data = JSON.parse(
    readFileSync(join(import.meta.dirname, `../../evals/results/${file}.json`), "utf8"),
  );
  const atomicName = resultsName({
    date: "2026-10-13",
    version: "0.1.128",
    run: "r",
    variant: "atomic",
  });

  it("leaves an atomic run out by its kind", () => {
    expect(atomicName).toBe("2026-10-13-0.1.128.r.atomic.json");
    const name = atomicName.replace(/\.json$/, "");
    const base = { name: file, data };
    const runs = (l: ReturnType<typeof trendLines>) => l.flatMap((x) => x.runs.map((r) => r.name));
    expect(runs(trendLines([base]))).toEqual([file]);
    for (const atomic of [
      { name, data: { ...data, date: "2026-10-13", kind: "atomic" } },
      { name, data: { ...data, date: "2026-10-13", kind: "atomic-variant" } },
    ])
      expect(runs(trendLines([base, atomic]))).toEqual([file]);
    expect(trendMarkdown([base, { name, data: { ...data, kind: "atomic" } }])).not.toContain(name);
  });
});
