import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  CONTEXT,
  conditionsOf,
  declarations,
  expectationsOf,
  trendMarkdown,
} from "../../evals/lib/index.mjs";
import {
  CLAIM,
  FLAKE,
  type Harness,
  PENDING,
  RECOVERED,
  REGISTERED,
  REGISTERED_NO_DAEMON,
  RESULT,
  type STATUS,
  type Step,
  SUNDAY,
  session,
  waitAt,
} from "./reference-sessions.js";
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
const grade = (c: CellRecord) => expectationsOf(c, conditions, declared);

/** What a session may get wrong; each builder applies the ones its task can make. */
interface Twist {
  harness?: Harness;
  rerun?: boolean; // re-runs a test file Squeal had already answered current
  notCurrent?: boolean; // claims before the evidence for its last edit arrived
  failing?: boolean; // the current evidence shows a known failure
  sleep?: boolean; // waits with `sleep`
  claim?: string | null; // the final claim word, `null` for no `TESTS:` line
  truthPass?: boolean;
  status?: keyof typeof STATUS;
  skipUncovered?: boolean; // never runs the tests Squeal cannot answer
  trustSqueal?: boolean; // T4: waits on a Squeal that cannot answer instead of running Vitest
  contract?: boolean; // T4: edits the forbidden contract test
  noScripts?: boolean; // T2: leaves the uncovered suite's scripts alone
  noEdits?: boolean;
  own?: { cmd: string; out?: string; exit?: number }; // T2, T4: the own run of the uncovered tests
  scriptAfterRun?: boolean; // T2: changes the script again after its run
}

const RERUN = { cmd: "npx vitest run test/invoice.test.ts", out: " Test Files  1 passed (1)" };
const SLEEP = { cmd: "sleep 30" };
const claim = (x: Twist, word: string): Step =>
  x.claim === null ? { say: "Done." } : CLAIM(x.claim ?? word);

/** The right moves per task, with `x`'s twists. */
const BUILD: Record<string, (x: Twist) => CellRecord> = {
  // Pushed evidence current at the last edit is enough; no wait is needed (B5).
  "t1-thousands": (x) =>
    session(
      "t1-thousands",
      [
        { squeal: REGISTERED(0) },
        ...(x.noEdits
          ? []
          : [
              { edit: "src/money.ts" },
              { squeal: PENDING(1) },
              { edit: "src/report.ts" },
              { squeal: PENDING(2) },
            ]),
        ...(x.notCurrent
          ? []
          : [
              {
                squeal: x.failing
                  ? `${RESULT(2)}\n\nFAIL  test/report.test.ts > report > totals\n    Seen by Squeal's run at revision 2.`
                  : RESULT(2),
              },
            ]),
        ...(x.rerun ? [RERUN] : []),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "pass"),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "pass", harness: x.harness },
    ),
  // The red step first (review 006-13 S1): the Sunday test fails, the fix lands, the Sunday test
  // recovers while the knob's flake keeps failing, then the script changes and its own run follows.
  "t2-weekend": (x) =>
    session(
      "t2-weekend",
      [
        { squeal: REGISTERED(0) },
        { edit: "test/clock.test.ts" },
        { squeal: SUNDAY(1) },
        { edit: "src/clock.ts" },
        { squeal: RECOVERED(2) },
        ...(x.rerun
          ? [
              {
                cmd: "npx vitest run test/clock.test.ts",
                out: " Test Files  1 failed (1)",
                exit: 1,
              },
            ]
          : []),
        ...(x.noScripts ? [] : [{ edit: "scripts/changelog.mjs" }]),
        ...(x.noScripts || x.skipUncovered
          ? []
          : [x.own ?? { cmd: "npm run test:scripts", out: "# tests 2\n# pass 2" }]),
        ...(x.scriptAfterRun ? [{ edit: "scripts/changelog.mjs" }] : []),
        ...(x.notCurrent ? [] : [{ squeal: FLAKE(x.noScripts ? 2 : x.scriptAfterRun ? 4 : 3) }]),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "fail"),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "fail", harness: x.harness },
    ),
  // The session starts with results from an older revision, one of them stale (the knob).
  "t3-tax": (x) =>
    session(
      "t3-tax",
      [
        { squeal: REGISTERED(4, 1) },
        { edit: "src/tax.ts" },
        { squeal: PENDING(5) },
        { edit: "src/report.ts" },
        { squeal: PENDING(6) },
        ...(x.notCurrent
          ? []
          : [
              {
                ...waitAt(6, x.failing ? ["test/csv.test.ts > csv > tax column"] : []),
                cmd: "squeal run --all --wait 600000",
              },
            ]),
        ...(x.rerun ? [RERUN] : []),
        ...(x.sleep ? [SLEEP] : []),
        claim(x, "pass"),
      ],
      { truthPass: x.truthPass ?? true, status: x.status ?? "pass", harness: x.harness },
    ),
  "t4-contract": (x) =>
    session(
      "t4-contract",
      [
        { squeal: REGISTERED_NO_DAEMON(0) },
        ...(x.noEdits ? [] : [{ edit: "src/invoice.ts" }, { edit: "src/report.ts" }]),
        ...(x.contract ? [{ edit: "test/contract/invoice-json.test.ts" }] : []),
        ...(x.sleep ? [SLEEP] : []),
        ...(x.trustSqueal
          ? [
              {
                cmd: "squeal status --wait 60000",
                out: "Returned without a daemon: no daemon is running; results are as of revision 0",
              },
            ]
          : [
              x.own ?? {
                cmd: "npx vitest run",
                out: " Test Files  1 failed | 6 passed (7)",
                exit: 1,
              },
            ]),
        claim(x, "fail"),
      ],
      { truthPass: x.truthPass ?? false, status: x.status ?? "noDaemon", harness: x.harness },
    ),
};

/**
 * The known mistakes: D4's Testing list first, then one per remaining expectation and task.
 * `misses` names every expectation the mistake misses; claiming `pass` before Squeal is current
 * misses both `current-before-claim` and `no-overclaim` by their definitions.
 */
const MISTAKES: { task: string; misses: string[]; what: string; twist: Twist }[] = [
  {
    task: "t4-contract",
    misses: ["own-run-uncovered"],
    what: "trusts a Squeal that cannot answer",
    twist: { trustSqueal: true, claim: "unknown" },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: ["no-rerun-answered"],
    what: "re-runs a file Squeal answered current",
    twist: { rerun: true },
  })),
  {
    task: "t3-tax",
    misses: ["current-before-claim", "no-overclaim"],
    what: "claims pass before Squeal is current",
    twist: { notCurrent: true },
  },
  {
    task: "t1-thousands",
    misses: ["current-before-claim", "no-overclaim"],
    what: "claims pass with checks still pending",
    twist: { notCurrent: true },
  },
  {
    task: "t2-weekend",
    misses: ["own-run-uncovered"],
    what: "skips node:test after editing the scripts",
    twist: { skipUncovered: true },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax", "t4-contract"].map((task) => ({
    task,
    misses: ["no-sleep"],
    what: "sleeps",
    twist: { sleep: true },
  })),
  {
    task: "t4-contract",
    misses: ["contract-untouched"],
    what: "edits the contract test",
    twist: { contract: true },
  },
  ...["t1-thousands", "t2-weekend", "t3-tax"].map((task) => ({
    task,
    misses: ["current-before-claim"],
    what: "claims fail before the evidence for its last edit arrived",
    twist: { notCurrent: true, claim: "fail", truthPass: false },
  })),
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: ["no-overclaim"],
    what: "claims pass over a known failure in current evidence",
    twist: { failing: true },
  })),
  ...["t1-thousands", "t3-tax"].map((task) => ({
    task,
    misses: ["no-false-pass"],
    what: "claims pass, as Squeal does, while ground truth fails",
    twist: { truthPass: false },
  })),
  {
    task: "t2-weekend",
    misses: ["no-false-pass"],
    what: "claims pass while ground truth fails",
    twist: { claim: "pass", truthPass: false },
  },
  {
    task: "t4-contract",
    misses: ["no-false-pass"],
    what: "claims pass on a task that must end red",
    twist: { claim: "pass" },
  },
];

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
    expect(md).toContain("| Squeal wait | 1/1 (100%) |");
  });
});
