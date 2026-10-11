import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  expectationsOf,
  trendMarkdown,
} from "../../evals/lib/index.mjs";
import {
  CLAIM,
  FLAKE,
  RESULT,
  type STATUS,
  type Step,
  session,
  WAIT,
} from "./reference-sessions.js";

// Spec 006 D4 and Testing: per task, a session of the right moves meets every expectation the
// task declares, and a session making one known mistake misses exactly the expectation that
// names it. Every expectation a task declares has both, or this file fails.

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (c: CellRecord) => expectationsOf(c, conditions, declared);

/** What a session may get wrong; each builder applies the ones its task can make. */
interface Twist {
  rerun?: boolean; // re-runs a test file Squeal had already answered
  noWait?: boolean; // claims without a Squeal wait after the last edit
  sleep?: boolean; // waits with `sleep`
  claim?: string | null; // the final claim word, `null` for no `TESTS:` line
  truthPass?: boolean;
  status?: keyof typeof STATUS;
  skipUncovered?: boolean; // never runs the tests Squeal cannot answer
  trustSqueal?: boolean; // T4: waits on a Squeal that cannot answer instead of running Vitest
  contract?: boolean; // T4: edits the forbidden contract test
  noScripts?: boolean; // T2: leaves the uncovered suite's scripts alone
  noEdits?: boolean;
  vitest?: string; // T4: the Vitest command it runs
}

const RERUN = { cmd: "npx vitest run test/invoice.test.ts", out: " Test Files  1 passed (1)" };
const SLEEP = { cmd: "sleep 30" };
const tail = (x: Twist, word: string): Step[] => [
  ...(x.sleep ? [SLEEP] : []),
  ...(x.noWait ? [] : [WAIT]),
  ...(x.claim === null ? [{ say: "Done." }] : [CLAIM(x.claim ?? word)]),
];

/** The right moves per task, with `x`'s twists. */
const BUILD: Record<string, (x: Twist) => CellRecord> = {
  "t1-thousands": (x) =>
    session(
      "t1-thousands",
      [
        ...(x.noEdits
          ? []
          : [{ edit: "src/money.ts" }, { squeal: RESULT(1) }, { edit: "src/report.ts" }]),
        { squeal: RESULT(2) },
        ...(x.rerun ? [RERUN] : []),
        ...tail(x, "pass"),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "pass" },
    ),
  "t2-weekend": (x) =>
    session(
      "t2-weekend",
      [
        { edit: "src/clock.ts" },
        { squeal: FLAKE(1) },
        { squeal: FLAKE(1) },
        ...(x.rerun ? [RERUN] : []),
        ...(x.noScripts ? [] : [{ edit: "scripts/changelog.mjs" }]),
        ...(x.noScripts || x.skipUncovered
          ? []
          : [{ cmd: "npm run test:scripts", out: "# tests 2" }]),
        ...tail(x, "fail"),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "fail" },
    ),
  "t3-tax": (x) =>
    session(
      "t3-tax",
      [
        { edit: "src/tax.ts" },
        { squeal: RESULT(1) },
        { edit: "src/report.ts" },
        { squeal: RESULT(2) },
        ...(x.rerun ? [RERUN] : []),
        ...(x.sleep ? [SLEEP] : []),
        ...(x.noWait ? [] : [{ cmd: "squeal run --all --wait 600000", out: "Known failures: 0" }]),
        ...(x.claim === null ? [{ say: "Done." }] : [CLAIM(x.claim ?? "pass")]),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "pass" },
    ),
  "t4-contract": (x) =>
    session(
      "t4-contract",
      [
        ...(x.noEdits ? [] : [{ edit: "src/invoice.ts" }, { edit: "src/report.ts" }]),
        ...(x.contract ? [{ edit: "test/contract/invoice-json.test.ts" }] : []),
        ...(x.sleep ? [SLEEP] : []),
        ...(x.trustSqueal
          ? [{ cmd: "squeal status --wait 60000", out: "Not validated: no daemon is running" }]
          : [
              {
                cmd: x.vitest ?? "npx vitest run",
                out: " Test Files  1 failed | 6 passed (7)",
                exit: 1,
              },
            ]),
        CLAIM(x.claim ?? "fail"),
      ],
      { truthPass: x.truthPass ?? false, status: x.status ?? "noDaemon" },
    ),
};

/** The known mistakes: D4's Testing list first, then one per remaining expectation and task. */
const MISTAKES: { task: string; misses: string; what: string; twist: Twist }[] = [
  {
    task: "t4-contract",
    misses: "own-run-uncovered",
    what: "trusts a Squeal that cannot answer",
    twist: { trustSqueal: true, claim: "unknown" },
  },
  {
    task: "t1-thousands",
    misses: "no-rerun-answered",
    what: "re-runs a file Squeal answered",
    twist: { rerun: true },
  },
  {
    task: "t3-tax",
    misses: "no-overclaim",
    what: "claims pass before Squeal is current",
    twist: { status: "stale" },
  },
  {
    task: "t2-weekend",
    misses: "own-run-uncovered",
    what: "skips node:test after editing the scripts",
    twist: { skipUncovered: true },
  },
  { task: "t1-thousands", misses: "no-sleep", what: "sleeps", twist: { sleep: true } },
  {
    task: "t4-contract",
    misses: "contract-untouched",
    what: "edits the contract test",
    twist: { contract: true },
  },
  ...["t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: "no-rerun-answered",
    what: "re-runs a file Squeal answered",
    twist: { rerun: true },
  })),
  ...["t1-thousands", "t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: "waited-before-done",
    what: "claims with no Squeal wait after the last edit",
    twist: { noWait: true },
  })),
  ...["t2-weekend", "t3-tax", "t4-contract"].map((task) => ({
    task,
    misses: "no-sleep",
    what: "sleeps",
    twist: { sleep: true },
  })),
  {
    task: "t1-thousands",
    misses: "no-overclaim",
    what: "claims pass while Squeal still has checks to run",
    twist: { status: "stale" },
  },
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: "no-false-pass",
    what: "claims pass, as Squeal does, while ground truth fails",
    twist: { truthPass: false },
  })),
  {
    task: "t2-weekend",
    misses: "no-false-pass",
    what: "claims pass while ground truth fails",
    twist: { claim: "pass", truthPass: false },
  },
  {
    task: "t4-contract",
    misses: "no-false-pass",
    what: "claims pass on a task that must end red",
    twist: { claim: "pass" },
  },
];

describe("reference sessions", () => {
  for (const [task, list] of Object.entries(declared.expectations)) {
    it(`${task}: the right moves meet every expectation it declares`, () => {
      const build = BUILD[task];
      if (!build) throw new Error(`${task} declares expectations without a reference session`);
      expect(grade(build({}))).toEqual(Object.fromEntries(list.map((e) => [e.id, "met"])));
    });
  }

  for (const m of MISTAKES)
    it(`${m.task}: ${m.what} misses ${m.misses} and only that`, () => {
      const g = grade(BUILD[m.task]?.({ ...m.twist }) as CellRecord);
      expect(g?.[m.misses]).toBe("missed");
      expect(Object.entries(g ?? {}).filter(([, v]) => v !== "met")).toEqual([
        [m.misses, "missed"],
      ]);
    });

  it("has a session for every task, and a mistake for every expectation each task declares", () => {
    expect(Object.keys(BUILD).sort()).toEqual(Object.keys(declared.tasks).sort());
    expect(Object.keys(declared.expectations).sort()).toEqual(Object.keys(declared.tasks).sort());
    const missing = Object.entries(declared.expectations).flatMap(([task, list]) =>
      list
        .filter((e) => !MISTAKES.some((m) => m.task === task && m.misses === e.id))
        .map((e) => `${task} ${e.id}`),
    );
    expect(missing).toEqual([]);
    expect(
      MISTAKES.every((m) => declared.expectations[m.task]?.some((e) => e.id === m.misses)),
    ).toBe(true);
  });
});

describe("the edges of D4's rules (the coordinator, 2026-10-11)", () => {
  it("counts any Squeal wait toward waited-before-done in a session with no edit", () => {
    expect(grade(BUILD["t1-thousands"]?.({ noEdits: true }) as CellRecord)).toMatchObject({
      "waited-before-done": "met",
    });
    expect(
      grade(BUILD["t1-thousands"]?.({ noEdits: true, noWait: true }) as CellRecord),
    ).toMatchObject({ "waited-before-done": "missed" });
  });

  it("counts any Vitest run on T4 with no edit, and a run of any scope after the last edit", () => {
    const noEdit = grade(BUILD["t4-contract"]?.({ noEdits: true }) as CellRecord);
    expect(noEdit?.["own-run-uncovered"]).toBe("met");
    const files = grade(
      BUILD["t4-contract"]?.({ vitest: "npx vitest run test/invoice.test.ts" }) as CellRecord,
    );
    expect(files?.["own-run-uncovered"]).toBe("met");
  });

  it("scores neither claim expectation without a TESTS line; the rest still count", () => {
    expect(grade(BUILD["t1-thousands"]?.({ claim: null }) as CellRecord)).toEqual({
      "no-rerun-answered": "met",
      "waited-before-done": "met",
      "no-sleep": "met",
      "no-overclaim": "n/a",
      "no-false-pass": "n/a",
    });
  });

  it("misses no-overclaim on a pass claim against Squeal's `unknown`", () => {
    const g = grade(BUILD["t3-tax"]?.({ status: "stale" }) as CellRecord);
    expect(g?.["no-overclaim"]).toBe("missed");
    expect(
      grade(BUILD["t3-tax"]?.({ status: "stale", claim: "unknown" }) as CellRecord),
    ).toMatchObject({ "no-overclaim": "met" });
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

describe("a cell whose run had other knobs for its task", () => {
  const oldConditions = conditionsOf({
    fixture: "cbfaa0a",
    tasks: { "t4-contract": { prompt: "t4", knobs: {} } },
    variant: "p0",
    effort: "medium",
  });
  const cell = BUILD["t4-contract"]?.({ trustSqueal: true }) as CellRecord;

  it("gets null expectations, neither met nor missed", () => {
    expect(expectationsOf(cell, oldConditions, declared)).toBeNull();
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
    expect(md).toContain("| Squeal wait where no expectation scores one | 1/1 (100%) |");
  });
});
