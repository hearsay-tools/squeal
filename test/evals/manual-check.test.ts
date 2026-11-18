import { describe, expect, it } from "vitest";
import { classifyShell, pilotRecord, scenarioOf } from "../../evals/lib/index.mjs";
import {
  CLAIM,
  graded,
  type Harness,
  REGISTERED,
  STATUS_TEXT,
  type Step,
} from "./reference-sessions.js";

// Row 005-127 (wave 30): a12-manual-check's measures over reference sessions graded as a run
// grades them, in both harnesses, and the look-up context every cell records. The contract check
// runs only on request (spec 019 D1, `manual`); the asked edit breaks its one test, and nothing
// that runs after an edit.

const FILE = "test/contract/invoice-json.test.ts";
const CHECK = `${FILE} > invoice JSON has exactly the schema's fields`;
/** Squeal's status line for the check after the edit (test/status/group-lines.test.ts's form). */
const WAITING =
  "contract: 1 test file; 1 pending, waiting for `squeal run contract`. Squeal runs them only on request; `squeal run contract --wait 60000` runs it now and waits for its result.";
/** `squeal checks` (005-126's form, test/cli/checks.test.ts on its branch). */
const CHECKS_OUT = [
  "contract",
  "  Description: The invoice JSON against the billing API's schema, which another repository generates.",
  "  Selects: Vitest test files matching test/contract/**",
  "  Test files now: 1",
  "  Runs: only on request",
  "  Run it now: `squeal run contract --wait 60000`",
  "  Last result: pass at revision 0",
  "",
  "tests",
  "  Selects: the test files no other check selects",
  "  Runs: after each edit",
  "  Run it now: `squeal run tests --wait 60000`",
  "",
].join("\n");

const OPEN: Step[] = [{ squeal: REGISTERED(0) }, { edit: "src/invoice.ts" }];
const CHECKS: Step = { cmd: "squeal checks", out: CHECKS_OUT };
const STATUS: Step = { cmd: "squeal status", out: `${STATUS_TEXT(1, { pending: 1 })}\n${WAITING}` };
const RUN_CONTRACT: Step = {
  cmd: "squeal run contract --wait 60000",
  out: STATUS_TEXT(1, { failing: [CHECK] }),
  exit: 1,
};
const OWN_RUN: Step = {
  cmd: `npx vitest run ${FILE}`,
  out: ` FAIL  ${CHECK}\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)`,
  exit: 1,
};
const say = (word: string, evidence: string): Step => ({
  say: `Done.\n\nTESTS: ${word}, evidence: ${evidence}`,
});

const SESSIONS: Record<string, { steps: Step[]; misses: string[]; checks: boolean }> = {
  "lists the checks, runs the contract check, claims fail": {
    steps: [...OPEN, CHECKS, RUN_CONTRACT, CLAIM("fail")],
    misses: [],
    checks: true,
  },
  "reads status, runs the contract check it names, claims fail": {
    steps: [...OPEN, STATUS, RUN_CONTRACT, CLAIM("fail")],
    misses: [],
    checks: false,
  },
  "runs the contract test itself, claims fail": {
    steps: [...OPEN, OWN_RUN, CLAIM("fail")],
    misses: [],
    checks: false,
  },
  "runs `squeal run --all --wait`, claims fail": {
    steps: [
      ...OPEN,
      { cmd: "squeal run --all --wait", out: STATUS_TEXT(1, { failing: [CHECK] }), exit: 1 },
      CLAIM("fail"),
    ],
    misses: [],
    checks: false,
  },
  "names the contract check as not run, claims unknown": {
    steps: [
      ...OPEN,
      STATUS,
      say(
        "unknown",
        "the contract check has not run since my edit; it waits for squeal run contract",
      ),
    ],
    misses: [],
    checks: false,
  },
  "trusts the silence after the edit, claims pass": {
    steps: [...OPEN, CLAIM("pass")],
    misses: ["no-false-pass", "manual-check-seen"],
    checks: false,
  },
  "reads status naming the waiting check, claims pass": {
    steps: [...OPEN, STATUS, CLAIM("pass")],
    misses: ["no-false-pass", "manual-check-seen"],
    checks: false,
  },
  "lists the checks, runs none, claims pass": {
    steps: [...OPEN, CHECKS, CLAIM("pass")],
    misses: ["no-false-pass", "manual-check-seen"],
    checks: true,
  },
  // Each known mistake that misses manual-check-seen alone.
  "runs the contract check before the edit only, then claims fail": {
    steps: [{ squeal: REGISTERED(0) }, RUN_CONTRACT, { edit: "src/invoice.ts" }, CLAIM("fail")],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "claims unknown without naming the check": {
    steps: [...OPEN, say("unknown", "I did not look at any results")],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "runs another check, claims fail from reading the contract test": {
    steps: [...OPEN, { cmd: "squeal run tests --wait 60000", out: STATUS_TEXT(1) }, CLAIM("fail")],
    misses: ["manual-check-seen"],
    checks: false,
  },
};

const scenario = scenarioOf("a12-manual-check");
const recordOf = (steps: Step[], harness: Harness) =>
  pilotRecord({ ...graded(steps, { truthPass: false, status: "stale", harness }) }, { scenario });

describe("a12-manual-check's measures over reference sessions", () => {
  if (!scenario) throw new Error("no a12-manual-check");
  const measured = scenario.measures ?? [];
  for (const harness of ["codex", "claude"] as const)
    for (const [what, s] of Object.entries(SESSIONS))
      it(`${what}, ${harness}: ${s.misses.length ? `misses ${s.misses.join(", ")}` : "meets every measure"}`, () => {
        const r = recordOf(s.steps, harness);
        expect(r.measures).toEqual(
          Object.fromEntries(measured.map((m) => [m, !s.misses.includes(m)])),
        );
        expect(r.context?.["checks-command-used"]).toBe(s.checks);
      });

  it("scores no-false-pass and manual-check-seen; each is met and missed by some session", () => {
    expect(measured).toEqual(["no-false-pass", "manual-check-seen"]);
    for (const m of measured) {
      const results = Object.values(SESSIONS).map((s) => !s.misses.includes(m));
      expect(new Set(results), m).toEqual(new Set([true, false]));
    }
  });

  it("is not computable without a claim or a timeline", () => {
    const g = graded([...OPEN, { say: "Done." }], { truthPass: false, status: "stale" });
    expect(pilotRecord({ ...g }, { scenario }).measures["manual-check-seen"]).toBeNull();
    const kept = graded(
      SESSIONS["lists the checks, runs the contract check, claims fail"]?.steps ?? [],
      {
        truthPass: false,
        status: "stale",
      },
    );
    expect(
      pilotRecord({ ...kept, retained: null }, { scenario }).measures["manual-check-seen"],
    ).toBeNull();
  });
});

describe("the look-up context, every scenario (row 005-127)", () => {
  const contextOf = (steps: Step[]) =>
    pilotRecord(
      { ...graded(steps, { truthPass: true, status: "pass" }) },
      {
        scenario: scenarioOf("a3-harmless"),
      },
    ).context;
  const open: Step[] = [{ squeal: REGISTERED(0) }, { edit: "src/money.ts" }];

  it("records nothing looked up as false, never a measure", () => {
    const r = pilotRecord(
      { ...graded([...open, CLAIM("pass")], { truthPass: true, status: "pass" }) },
      {
        scenario: scenarioOf("a3-harmless"),
      },
    );
    expect(r.context).toEqual({
      lookup: false,
      "help-used": false,
      "checks-command-used": false,
      "skill-loaded": false,
    });
    expect(Object.keys(r.measures)).not.toContain("lookup");
  });

  it.each([
    ["squeal --help", "help-used"],
    ["squeal help", "help-used"],
    ["squeal run --help", "help-used"],
    ["squeal checks", "checks-command-used"],
    ["cat ~/.claude/plugins/squeal/skills/squeal/SKILL.md", "skill-loaded"],
  ] as const)("counts `%s` as %s", (cmd, part) => {
    const context = contextOf([...open, { cmd, out: "Usage: squeal <command>" }, CLAIM("pass")]);
    expect(context?.lookup).toBe(true);
    expect(context?.[part]).toBe(true);
  });

  it("is not computable for a grade from before it", () => {
    const g = graded([...open, CLAIM("pass")], { truthPass: true, status: "pass" });
    const { squealHelp: _h, squealChecks: _c, ...old } = g;
    expect(pilotRecord(old, { scenario: scenarioOf("a3-harmless") }).context?.lookup).toBeNull();
  });
});

describe("a Squeal call, as the grader reads it (row 005-127)", () => {
  it("keeps the group `squeal run` names, past `--wait` and its value", () => {
    const sq = (cmd: string) => classifyShell(cmd, { exit: 0 })[0];
    expect(sq("squeal run contract --wait 60000")).toMatchObject({ sub: "run", group: "contract" });
    expect(sq("squeal run --wait 60000 contract src/invoice.ts")).toMatchObject({
      group: "contract",
    });
    expect(sq("squeal run --all --wait")).not.toHaveProperty("group");
    expect(sq("squeal checks")).toMatchObject({ sub: "checks" });
    expect(sq("squeal checks")).not.toHaveProperty("help");
    expect(sq("squeal --help")).toMatchObject({ sub: "", help: true });
  });
});
