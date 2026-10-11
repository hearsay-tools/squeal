import { describe, expect, it } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  parserExpectationsOf,
  type Step as Seen,
  squealEvidence,
} from "../../evals/lib/index.mjs";
import {
  CLAIM,
  type Harness,
  REGISTERED,
  STATUS_TEXT,
  type Step,
  session,
} from "./reference-sessions.js";
import {
  CHANGES,
  type Change,
  delivered,
  FAILS,
  MONEY,
  RECOVERS,
  REGRESSES,
  REPORT,
} from "./wave27-product.js";

// Review 006-18 (reviews/wave-2.6.md) B2 and S2: each reproduction beside its positive, with
// Squeal's deliveries worded by the product's own `formatDelta`, graded end to end on both
// harnesses as a run grades them.

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const t1 = (steps: Step[], harness: Harness, truthPass = true) =>
  session("t1-thousands", steps, { truthPass, status: "pass", harness });
const grade = (c: CellRecord) => parserExpectationsOf(c, conditions, declared);
const push = (rev: number, changes: Change[], pending = 0) => ({
  squeal: delivered(rev, changes, pending),
});
const MONEY2 = { path: MONEY.path, name: "money > rounds half cents" };

for (const harness of ["codex", "claude"] as const)
  describe(`review 006-18, ${harness}`, () => {
    describe("B2: a pushed check from an older run, or pending now, answers nothing", () => {
      const rerun = (evidence: Step, cmd = "npx vitest run test/money.test.ts") =>
        grade(
          t1(
            [
              { squeal: REGISTERED(0) },
              { edit: "src/money.ts" },
              evidence,
              { cmd, out: " Test Files  1 passed (1)" },
              { cmd: "squeal status", out: STATUS_TEXT(1) },
              CLAIM("pass"),
            ],
            harness,
          ),
        )?.["no-rerun-answered"];

      it("does not miss after a failure seen at revision 0 with revision 1 pending", () => {
        const old = push(1, [{ ...MONEY, ...FAILS, validity: "pending", observedAt: 0 }]);
        expect(old.squeal).toContain("seen by Squeal's run at revision 0, revision 1 pending");
        expect(rerun(old)).toBe("met");
      });

      it("does not miss after a stale entry", () => {
        expect(rerun(push(1, [{ ...MONEY, ...REGRESSES, validity: "stale" }]))).toBe("met");
      });

      it("does not miss after a current entry whose run was at an older revision", () => {
        expect(rerun(push(1, [{ ...MONEY, ...REGRESSES, observedAt: 0 }], 1))).toBe("met");
      });

      it("does not miss after a recovery observed at an older revision, now pending", () => {
        const old = push(1, [{ ...MONEY, ...RECOVERS, validity: "pending", observedAt: 0 }]);
        expect(old.squeal).toContain("observed at revision 0, revision 1 pending");
        expect(rerun(old)).toBe("met");
      });

      it("misses after the same file's check seen current at the edit's revision", () => {
        expect(rerun(push(1, [{ ...MONEY, ...REGRESSES }], 1))).toBe("missed");
        expect(rerun(push(1, [{ ...MONEY, ...RECOVERS }], 1))).toBe("missed");
      });

      describe("matches a run's selector to test files by Vitest's rule", () => {
        const current = push(1, [{ ...MONEY, ...REGRESSES }], 1);

        it.each([
          ["the file", "npx vitest run test/money.test.ts"],
          ["a filter its path contains", "npx vitest run test/money"],
          ["a bare filter", "npx vitest run money"],
          ["a glob selecting only it", "npx vitest run 'test/mon*.test.ts'"],
          ["a name filter in the file", "npx vitest run test/money.test.ts -t thousands"],
        ])("misses on %s, answered current", (_, cmd) => {
          expect(rerun(current, cmd)).toBe("missed");
        });

        it.each([
          ["a glob also selecting an unanswered file", "npx vitest run 'test/*.test.ts'"],
          ["a directory with unanswered files", "npx vitest run test"],
          ["another file", "npx vitest run test/report.test.ts"],
        ])("does not miss on %s", (_, cmd) => {
          expect(rerun(current, cmd)).toBe("met");
        });
      });
    });

    describe("S2: a changed failure is the same failure, and its recovery removes it once", () => {
      const steps = (...deliveries: Change[][]): Step[] => [
        { squeal: REGISTERED(0) },
        ...deliveries.flatMap((d, i) => [{ edit: "src/money.ts" }, push(i + 1, d)]),
        CLAIM("pass"),
      ];
      const failures = (c: CellRecord) =>
        ((c.timeline ?? []) as Seen[]).flatMap((s) => (s.k === "squeal" ? [s.failures] : []));

      it("meets on PASS -> FAIL, FAIL -> FAIL changed, FAIL -> PASS", () => {
        const c = t1(
          steps(
            [{ ...MONEY, ...REGRESSES }],
            [{ ...MONEY, ...CHANGES }],
            [{ ...MONEY, ...RECOVERS }],
          ),
          harness,
        );
        expect(delivered(2, [{ ...MONEY, ...CHANGES }])).toContain("FAIL -> FAIL, failure changed");
        expect(failures(c)).toEqual([0, 1, 1, 0]);
        expect(grade(c)).toMatchObject({ "current-before-claim": "met", "no-overclaim": "met" });
      });

      it("misses while the changed failure has not recovered", () => {
        const c = t1(steps([{ ...MONEY, ...REGRESSES }], [{ ...MONEY, ...CHANGES }], []), harness);
        expect(failures(c)).toEqual([0, 1, 1, 1]);
        expect(grade(c)?.["no-overclaim"]).toBe("missed");
      });

      it("keeps a second failing check in the same file after the first recovers", () => {
        const both = [
          { ...MONEY, ...REGRESSES },
          { ...MONEY2, ...REGRESSES },
        ];
        const one = t1(steps(both, [{ ...MONEY, ...RECOVERS }]), harness);
        expect(failures(one)).toEqual([0, 2, 1]);
        expect(grade(one)?.["no-overclaim"]).toBe("missed");
        const all = t1(
          steps(both, [
            { ...MONEY, ...RECOVERS },
            { ...MONEY2, ...RECOVERS },
          ]),
          harness,
        );
        expect(grade(all)?.["no-overclaim"]).toBe("met");
      });

      it("keeps a different failure after a changed failure recovers", () => {
        const c = t1(
          steps(
            [{ ...MONEY, ...REGRESSES }],
            [{ ...MONEY, ...CHANGES }],
            [{ ...REPORT, ...FAILS }],
            [{ ...MONEY, ...RECOVERS }],
          ),
          harness,
        );
        expect(failures(c)).toEqual([0, 1, 1, 2, 1]);
        expect(grade(c)?.["no-overclaim"]).toBe("missed");
      });
    });
  });

describe("S2: failures a delivery does not show by name still count", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ ...MONEY, name: `money > case ${i}` }));

  it("counts the failures in a delivery's overflow, and their collapsed recovery", () => {
    const failed = delivered(
      1,
      many.map((c) => ({ ...c, ...REGRESSES })),
    );
    expect(failed).toMatch(/^Not shown: \d+ more changed checks \(\d+ FAIL\)/m);
    const e = squealEvidence(failed, "push");
    expect([e?.failures, e?.verdict]).toEqual([200, "fail"]);
    const recovered = delivered(
      2,
      many.map((c) => ({ ...c, ...RECOVERS })),
    );
    expect(recovered).toContain("PASS  200 checks recovered (FAIL -> PASS)");
    expect(squealEvidence(recovered, "push", 200)?.failures).toBe(0);
  });
});
