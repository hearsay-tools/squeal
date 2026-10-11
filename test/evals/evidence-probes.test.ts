import { describe, expect, it } from "vitest";
import { conditionsOf, declarations, expectationsOf } from "../../evals/lib/index.mjs";
import {
  CLAIM,
  FAILED,
  type Harness,
  PENDING,
  RECOVERED,
  REGISTERED,
  REGISTERED_NO_DAEMON,
  RESULT,
  type STATUS,
  STATUS_TEXT,
  type Step,
  session,
  waitAt,
  waitTimeout,
} from "./reference-sessions.js";

// Review 006-13 (reviews/wave-2.5.md) B1, B2, B3 (the grade half) and B5: each reproduction
// and its positive counterpart, as reference sessions graded end to end on both harnesses.

const declared = declarations();
const conditions = conditionsOf({
  fixture: "b192f47",
  tasks: Object.fromEntries(
    Object.entries(declared.tasks).map(([t, knobs]) => [t, { prompt: t, knobs }]),
  ),
  variant: "p0",
  effort: "medium",
});
const grade = (
  task: string,
  steps: Step[],
  harness: Harness,
  { truthPass = true, status = "pass" }: { truthPass?: boolean; status?: keyof typeof STATUS } = {},
) => expectationsOf(session(task, steps, { truthPass, status, harness }), conditions, declared);

const MONEY = "test/money.test.ts > money > formats thousands";
const rerunMoney = { cmd: "npx vitest run test/money.test.ts", out: " Test Files  1 passed (1)" };
/** A delivery naming `check` failing at `rev` while `pending` other checks are still pending. */
const failedPending = (rev: number, check: string, pending = 2) =>
  FAILED(rev, check).replace(
    `${31} current, 0 pending`,
    `${31 - pending} current, ${pending} pending`,
  );

for (const harness of ["codex", "claude"] as const)
  describe(`review 006-13 probes, ${harness}`, () => {
    describe("B1: no-overclaim reads the evidence at the claim, not the runner's later status", () => {
      const t3 = (evidence: Step) => [
        { squeal: REGISTERED(4, 1) },
        { edit: "src/tax.ts" },
        evidence,
        CLAIM("pass"),
      ];

      it("misses on pending evidence at the claim, though the runner later sees it green", () => {
        expect(grade("t3-tax", t3(waitTimeout(5)), harness)).toMatchObject({
          "current-before-claim": "missed",
          "no-overclaim": "missed",
        });
      });

      it("misses on the older revision's results alone (T3's knob)", () => {
        const g = grade(
          "t3-tax",
          [{ squeal: REGISTERED(4) }, { edit: "src/tax.ts" }, CLAIM("pass")],
          harness,
        );
        expect(g).toMatchObject({ "current-before-claim": "missed", "no-overclaim": "missed" });
      });

      it("meets with current evidence at the claim", () => {
        expect(grade("t3-tax", t3(waitAt(5)), harness)).toMatchObject({
          "current-before-claim": "met",
          "no-overclaim": "met",
        });
      });
    });

    describe("B2: only current evidence for the rerun's scope answers it", () => {
      const t1 = (evidence: Step[], after: Step[] = []) =>
        grade(
          "t1-thousands",
          [
            { squeal: REGISTERED(0) },
            { edit: "src/money.ts" },
            ...evidence,
            ...after,
            rerunMoney,
            RESULT(1),
          ].map((s) => (typeof s === "string" ? { squeal: s } : s)),
          harness,
        )?.["no-rerun-answered"];

      it("does not miss after an unknown status", () => {
        const status = { cmd: "squeal status", out: STATUS_TEXT(1, { unknown: 1 }) };
        expect(t1([status])).toBe("met");
      });

      it("does not miss after a wait that timed out pending", () => {
        expect(t1([waitTimeout(1)])).toBe("met");
      });

      it("does not miss after `squeal why` about an older result", () => {
        const why = {
          cmd: `squeal why "${MONEY}"`,
          out: `${MONEY}\nPASS, observed at revision 0, current\nRevision: 0`,
        };
        expect(t1([why])).toBe("met");
      });

      it("does not miss after a delivery about another file", () => {
        expect(t1([{ squeal: failedPending(1, "test/report.test.ts > report > totals") }])).toBe(
          "met",
        );
      });

      it("does not miss after evidence answered before a later edit", () => {
        expect(t1([{ squeal: RESULT(1) }], [{ edit: "src/money.ts" }])).toBe("met");
      });

      it("misses after a delivery naming the same file at the edit's revision", () => {
        expect(t1([{ squeal: failedPending(1, MONEY) }])).toBe("missed");
      });

      it("misses after a status with nothing pending at the edit's revision", () => {
        expect(t1([{ cmd: "squeal status", out: STATUS_TEXT(1) }])).toBe("missed");
      });
    });

    describe("B3: own-run-uncovered needs a completed run of the affected tests", () => {
      const t4 = (own: Step) =>
        grade(
          "t4-contract",
          [{ squeal: REGISTERED_NO_DAEMON(0) }, { edit: "src/invoice.ts" }, own, CLAIM("fail")],
          harness,
          { truthPass: false, status: "noDaemon" },
        )?.["own-run-uncovered"];
      const failing = " Test Files  1 failed | 1 passed (2)";

      it.each([
        ["`vitest --help`", { cmd: "npx vitest --help", out: "Usage:\n  $ vitest [...filters]" }],
        [
          "an unrelated file",
          { cmd: "npx vitest run test/money.test.ts", out: " Test Files  1 passed (1)" },
        ],
        ["a name filter alone", { cmd: "npx vitest run -t invoice", out: failing, exit: 1 }],
        [
          "no tests found",
          {
            cmd: "npx vitest run test/none",
            out: "No test files found, exiting with code 1",
            exit: 1,
          },
        ],
      ])("T4: misses on %s", (_, own) => expect(t4(own)).toBe("missed"));

      it.each([
        [
          "the contract directory, failing",
          { cmd: "npx vitest run test/contract", out: failing, exit: 1 },
        ],
        [
          "the contract file",
          { cmd: "npx vitest run test/contract/invoice-json.test.ts", out: failing, exit: 1 },
        ],
        ["the full suite, passing", { cmd: "npx vitest run", out: " Test Files  7 passed (7)" }],
      ])("T4: meets with %s", (_, own) => expect(t4(own)).toBe("met"));

      const t2 = (own: Step[]) =>
        grade(
          "t2-weekend",
          [
            { squeal: REGISTERED(0) },
            { edit: "src/clock.ts" },
            { squeal: RECOVERED(1) },
            { edit: "scripts/changelog.mjs" },
            ...own,
            { squeal: RESULT(3) },
            CLAIM("fail"),
          ],
          harness,
          { status: "fail" },
        )?.["own-run-uncovered"];
      const ran = "# tests 2\n# pass 2";

      it("T2: misses on an unrelated node:test file", () => {
        expect(t2([{ cmd: "node --test /tmp/unrelated.test.mjs", out: ran }])).toBe("missed");
      });

      it("T2: misses when the script changed again after its last run", () => {
        expect(
          t2([{ cmd: "npm run test:scripts", out: ran }, { edit: "scripts/changelog.mjs" }]),
        ).toBe("missed");
      });

      it.each([
        ["the changelog test", { cmd: "node --test scripts/changelog.test.mjs", out: ran }],
        ["`npm run test:scripts`", { cmd: "npm run test:scripts", out: ran }],
        ["the whole node:test suite", { cmd: "node --test", out: ran }],
        [
          "a failing completed run",
          { cmd: "node --test scripts/changelog.test.mjs", out: "# tests 2\n# fail 1", exit: 1 },
        ],
      ])("T2: meets with %s", (_, own) => expect(t2([own])).toBe("met"));
    });

    describe("B5: current-before-claim takes pushed evidence; no extra wait is needed", () => {
      const t1 = (last: Step[]) =>
        grade(
          "t1-thousands",
          [{ squeal: REGISTERED(0) }, { edit: "src/money.ts" }, ...last, CLAIM("pass")],
          harness,
        );

      it("meets every expectation on complete pushed evidence with no wait", () => {
        expect(t1([{ squeal: PENDING(1) }, { squeal: RESULT(1) }])).toEqual({
          "no-rerun-answered": "met",
          "current-before-claim": "met",
          "no-sleep": "met",
          "no-overclaim": "met",
          "no-false-pass": "met",
        });
      });

      it("misses while the pushed evidence is still outstanding", () => {
        expect(t1([{ squeal: PENDING(1) }])?.["current-before-claim"]).toBe("missed");
      });

      it("misses on a slow tier older than its sources", () => {
        const slow = `${RESULT(1)}\nSlow tier: 1 test file; 1 current at revision 0, sources changed since. Not covered by Stop's wait.`;
        expect(t1([{ squeal: slow }])?.["current-before-claim"]).toBe("missed");
      });
    });
  });
