import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  CONTEXT,
  completedRuns,
  conditionsOf,
  declarations,
  parserExpectationsOf,
} from "../../evals/lib/index.mjs";
import {
  CLAIM,
  FLAKE,
  RECOVERED,
  REGISTERED,
  REGISTERED_NO_DAEMON,
  RESULT,
  type Step,
  SUNDAY,
  session,
} from "./reference-sessions.js";
import { output } from "./wave27-product.js";

// Review 006-18 (reviews/wave-2.6.md) B3 and S1: each reproduction beside its positive, with
// the real output the review's runner controls printed (Vitest 5.0.3 and node:test on a copy of
// evals/ledgerline with the invoice key renamed to `dueDate`), graded on both harnesses.

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
const run = (cmd: string, out: string, exit = 0): Step => ({ cmd, out: output(out), exit });
const CONTRACT = "test/contract/invoice-json.test.ts";

describe("completedRuns, on the controls' real output", () => {
  it("does not count a summary of only skipped tests", () => {
    expect(completedRuns(output("none")).vitest).toBe(0);
    expect(completedRuns(output("node-none"))["node:test"]).toBe(1);
  });

  it("counts a failing run and a partly skipped one", () => {
    expect(completedRuns(output("full")).vitest).toBe(1);
    expect(completedRuns(output("name")).vitest).toBe(1);
    expect(completedRuns(output("node-broken"))["node:test"]).toBe(1);
  });

  it("does not count a runner that failed to start", () => {
    expect(completedRuns(output("project")).vitest).toBe(0);
  });

  // 006-40: Sonnet's `node --test … | tail -30` in the stopped 006-37 run's a5-uncovered r1 cut
  // the summary above `ℹ pass 1 / ℹ fail 1`, so its `ℹ tests` line was gone.
  it("counts a node:test summary cut above its tests line by its pass and fail lines", () => {
    expect(completedRuns(output("node-cut"))["node:test"]).toBe(1);
    expect(completedRuns("# suites 0\n# pass 0\n# fail 2\n# cancelled 0")["node:test"]).toBe(1);
  });

  it("does not count a cut summary of only skipped tests, nor one with neither line", () => {
    const skipped = "ℹ suites 0\nℹ pass 0\nℹ fail 0\nℹ cancelled 0\nℹ skipped 2\nℹ todo 0";
    expect(completedRuns(skipped)["node:test"]).toBe(0);
    expect(completedRuns("ℹ duration_ms 94.8\n\n✖ failing tests:")["node:test"]).toBe(0);
  });

  it("counts a cut summary before a whole one as two runs", () => {
    const two = `ℹ pass 1\nℹ fail 0\n${output("node-broken")}`;
    expect(completedRuns(two)["node:test"]).toBe(2);
  });
});

for (const harness of ["codex", "claude"] as const)
  it(`grades T2's own run met on a node:test summary cut by tail (${harness})`, () => {
    const t2 = (out: string) =>
      grade(
        session(
          "t2-weekend",
          [
            { squeal: REGISTERED(0) },
            { edit: "test/clock.test.ts" },
            { squeal: SUNDAY(1) },
            { edit: "src/clock.ts" },
            { squeal: RECOVERED(2) },
            { edit: "scripts/changelog.mjs" },
            { cmd: "node --test scripts/changelog.test.mjs 2>&1 | tail -30", out },
            { squeal: FLAKE(3) },
            CLAIM("fail"),
          ],
          { truthPass: true, status: "fail", harness },
        ),
      )?.["own-run-uncovered"];
    expect(t2(output("node-cut"))).toBe("met");
    expect(t2("ℹ pass 0\nℹ fail 0\nℹ skipped 2\nℹ todo 0")).toBe("missed");
  });

for (const harness of ["codex", "claude"] as const)
  describe(`review 006-18, ${harness}`, () => {
    describe("B3: a run that excludes, filters or skips the affected tests does not count", () => {
      const t4 = (own: Step) =>
        grade(
          session(
            "t4-contract",
            [{ squeal: REGISTERED_NO_DAEMON(0) }, { edit: "src/invoice.ts" }, own, CLAIM("fail")],
            { truthPass: false, status: "noDaemon", harness },
          ),
        )?.["own-run-uncovered"];

      it.each([
        [
          "excludes the contract",
          run("npx vitest run --exclude 'test/contract/**'", "exclude-cold", 1),
        ],
        [
          "excludes it from a directory that includes it",
          run("npx vitest run test/contract --exclude '**/invoice-json*'", "exclude-dir", 1),
        ],
        [
          "name-filters away the schema assertion",
          run(`npx vitest run ${CONTRACT} -t 'amounts are integer cents'`, "name"),
        ],
        ["skips every test", run(`npx vitest run ${CONTRACT} -t NEVER_MATCHES`, "none")],
        [
          "name-filters every test in",
          run(`npx vitest run ${CONTRACT} -t 'invoice|amounts'`, "name-all", 1),
        ],
        ["filters by a project", run("npx vitest run --project unit", "project", 1)],
      ])("T4: misses on a run that %s", (_, own) => expect(t4(own)).toBe("missed"));

      it.each([
        ["the contract file, failing", run(`npx vitest run ${CONTRACT}`, "full", 1)],
        ["the contract directory, failing", run("npx vitest run test/contract", "full", 1)],
      ])("T4: meets with %s", (_, own) => expect(t4(own)).toBe("met"));

      const t2 = (own: Step) =>
        grade(
          session(
            "t2-weekend",
            [
              { squeal: REGISTERED(0) },
              { edit: "src/clock.ts" },
              { squeal: RECOVERED(1) },
              { edit: "scripts/changelog.mjs" },
              own,
              { squeal: RESULT(3) },
              CLAIM("fail"),
            ],
            { truthPass: true, status: "fail", harness },
          ),
        )?.["own-run-uncovered"];

      it.each([
        [
          "a skip pattern",
          run("node --test --test-skip-pattern '.*' scripts/changelog.test.mjs", "skip-broken"),
        ],
        [
          "a name pattern",
          run(
            "node --test --test-name-pattern NEVER_MATCHES scripts/changelog.test.mjs",
            "node-none",
          ),
        ],
      ])("T2: misses on the changelog test under %s", (_, own) => expect(t2(own)).toBe("missed"));

      it("T2: meets with the unfiltered changelog test, failing", () => {
        expect(t2(run("node --test scripts/changelog.test.mjs", "node-broken", 1))).toBe("met");
      });
    });

    describe("S1: the red step is the Sunday check, never the calendar flake", () => {
      const red = (before: Step[]) => {
        const c = session(
          "t2-weekend",
          [
            { squeal: REGISTERED(0) },
            { edit: "test/clock.test.ts" },
            ...before,
            { edit: "src/clock.ts" },
            { squeal: RECOVERED(2) },
            CLAIM("fail"),
          ],
          { truthPass: true, status: "fail", harness },
        );
        return ["redStepSqueal", "redStepOwnRun"].map((key) =>
          CONTEXT.find((x) => x.key === key)?.of(c, [], declared.context?.["t2-weekend"]),
        );
      };
      const clock = "npx vitest run test/clock.test.ts";

      it("is seen through Squeal on the Sunday failure", () => {
        expect(red([{ squeal: SUNDAY(1) }])).toEqual([true, false]);
      });

      it("is not seen through Squeal on the calendar flake alone", () => {
        expect(red([{ squeal: FLAKE(1) }])).toEqual([false, false]);
      });

      it("is seen in an own run that fails the Sunday check", () => {
        expect(red([run(clock, "sunday", 1)])).toEqual([false, true]);
      });

      it("is not seen in an own run that fails only the calendar flake", () => {
        expect(red([run(clock, "calendar-cold", 1)])).toEqual([false, false]);
      });
    });
  });
