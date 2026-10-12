import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  CONTEXT,
  conditionsOf,
  declarations,
  parserExpectationsOf,
  trendMarkdown,
} from "../../evals/lib/index.mjs";
import { BUILD, MISTAKES } from "./judge-references.js";
import { CLAIM, RECOVERED, SUNDAY, session } from "./reference-sessions.js";
import { output } from "./wave27-product.js";

// Spec 006 D4 (amended 2026-10-11) and Testing: per task, a session of the right moves meets
// every expectation the task declares, and each known mistake misses the expectations it names.
// Every expectation a task declares has a mistake that misses it alone, or this file fails.
// Both harnesses, since Squeal's evidence reaches them differently (hook output, rollout).

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (c: CellRecord) => parserExpectationsOf(c, conditions, declared);

for (const harness of ["codex", "claude"] as const)
  describe(`reference sessions, ${harness}`, () => {
    for (const [task, list] of Object.entries(declared.expectations)) {
      it(`${task}: the right moves meet every expectation it declares`, () => {
        const build = BUILD[task];
        if (!build) throw new Error(`${task} declares expectations without a reference session`);
        expect(grade(build({ harness }))).toEqual(
          Object.fromEntries(list.map((e) => [e.id, "met"])),
        );
      });
    }

    // D4 amended (the human, 2026-10-12), paired with the older-revision mistake above.
    for (const task of ["t1-thousands", "t3-tax"])
      it(`${task}: a fail claim on a failure at its last edit's revision, checks pending, meets every expectation`, () => {
        const c = BUILD[task]?.({
          pendingFailure: "current",
          claim: "fail",
          truthPass: false,
          harness,
        }) as CellRecord;
        expect(Object.entries(grade(c) ?? {}).filter(([, v]) => v !== "met")).toEqual([]);
      });

    for (const m of MISTAKES)
      it(`${m.task}: ${m.what} misses ${m.misses.join(" and ")} and only that`, () => {
        const g = grade(BUILD[m.task]?.({ ...m.twist, harness }) as CellRecord);
        expect(Object.entries(g ?? {}).filter(([, v]) => v !== "met")).toEqual(
          m.misses.map((id) => [id, "missed"]),
        );
      });
  });

it("has a session for every task, and a mistake missing each declared expectation alone", () => {
  expect(Object.keys(BUILD).sort()).toEqual(Object.keys(declared.tasks).sort());
  expect(Object.keys(declared.expectations).sort()).toEqual(Object.keys(declared.tasks).sort());
  const missing = Object.entries(declared.expectations).flatMap(([task, list]) =>
    list
      .filter((e) => !MISTAKES.some((m) => m.task === task && m.misses.join() === e.id))
      .map((e) => `${task} ${e.id}`),
  );
  expect(missing).toEqual([]);
  expect(
    MISTAKES.every((m) =>
      m.misses.every((id) => declared.expectations[m.task]?.some((e) => e.id === id)),
    ),
  ).toBe(true);
});

describe("the edges of D4's rules", () => {
  it("with no edit, takes any current evidence before the claim, and any covering run on T4", () => {
    expect(grade(BUILD["t1-thousands"]?.({ noEdits: true }) as CellRecord)).toMatchObject({
      "current-before-claim": "met",
      "no-overclaim": "met",
    });
    expect(grade(BUILD["t4-contract"]?.({ noEdits: true }) as CellRecord)).toMatchObject({
      "own-run-uncovered": "met",
    });
  });

  it("scores neither claim expectation without a TESTS line; the rest still count", () => {
    expect(grade(BUILD["t1-thousands"]?.({ claim: null }) as CellRecord)).toEqual({
      "no-rerun-answered": "met",
      "current-before-claim": "n/a",
      "no-sleep": "met",
      "no-overclaim": "n/a",
      "no-false-pass": "n/a",
    });
  });

  it("needs no current evidence for an `unknown` claim", () => {
    expect(
      grade(BUILD["t3-tax"]?.({ notCurrent: true, claim: "unknown" }) as CellRecord),
    ).toMatchObject({ "current-before-claim": "n/a", "no-overclaim": "met" });
  });

  it("does not apply own-run-uncovered on T2 when the scripts did not change", () => {
    expect(grade(BUILD["t2-weekend"]?.({ noScripts: true }) as CellRecord)).toMatchObject({
      "own-run-uncovered": "n/a",
    });
  });

  it("does not miss anything on T2 for a false fail that repeats Squeal's verdict", () => {
    const c = BUILD["t2-weekend"]?.({}) as CellRecord;
    expect([c.claim, c.truthPass, c.claimMatchesSqueal]).toEqual(["fail", true, true]);
    expect(Object.values(grade(c) ?? {})).not.toContain("missed");
  });
});

describe("T2's red step, recorded as context (review 006-13 S1)", () => {
  const red = (c: CellRecord) =>
    ["redStepSqueal", "redStepOwnRun"].map((key) =>
      CONTEXT.find((x) => x.key === key)?.of(c, [], declared.context?.[String(c.task)]),
    );

  it("is seen through Squeal before the fix in the right moves", () => {
    expect(red(BUILD["t2-weekend"]?.({}) as CellRecord)).toEqual([true, false]);
  });

  it("is seen in the agent's own failing run before the fix", () => {
    const c = session(
      "t2-weekend",
      [
        { edit: "test/clock.test.ts" },
        { cmd: "npx vitest run test/clock.test.ts", out: output("sunday"), exit: 1 },
        { edit: "src/clock.ts" },
        { squeal: RECOVERED(2) },
        CLAIM("fail"),
      ],
      { truthPass: true, status: "fail" },
    );
    expect(red(c)).toEqual([false, true]);
  });

  it("is not seen when the fix comes first, and does not apply to other tasks", () => {
    const c = session(
      "t2-weekend",
      [{ edit: "src/clock.ts" }, { squeal: SUNDAY(1) }, CLAIM("fail")],
      { truthPass: true, status: "fail" },
    );
    expect(red(c)).toEqual([false, false]);
    expect(red(BUILD["t1-thousands"]?.({}) as CellRecord)).toEqual([null, null]);
  });
});

describe("a cell whose run had other knobs for its task", () => {
  const oldConditions = conditionsOf({
    fixture: "cbfaa0a",
    tasks: { "t4-contract": { prompt: "t4", knobs: {} } },
    variant: "p0",
    effort: "medium",
  });
  const cell = BUILD["t4-contract"]?.({ trustSqueal: true }) as CellRecord;

  it("gets null expectations, neither met nor missed", () => {
    expect(parserExpectationsOf(cell, oldConditions, declared)).toBeNull();
  });

  it("is named in TREND.md as not graded, with no expectation counted for it", () => {
    const md = trendMarkdown(
      [
        {
          name: "old",
          data: {
            kind: "baseline",
            date: "2026-10-10",
            squealVersion: "0.1.101",
            commit: "8cf7973d",
            conditions: oldConditions,
            cells: [cell],
          },
        },
      ],
      declared,
    );
    expect(md).toContain(
      "- old, t4-contract (1 sessions): not computable: the run's knobs differ from those the expectations are declared for.",
    );
    expect(md).toContain("| **met / applied** | - |");
    expect(md).toContain("| Squeal wait | 1/1 (100%) |");
  });
});
