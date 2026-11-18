import { describe, expect, it } from "vitest";
import {
  classifyShell,
  claudeTimeline,
  pilotRecord,
  scenarioOf,
  skillReadsOf,
} from "../../evals/lib/index.mjs";
import {
  CLAIM,
  claudeEvents,
  graded,
  type Harness,
  PENDING,
  REGISTERED,
  RESULT,
  regradedForms,
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

/** Form A's start message names the check in its group sentence (primer.ts `momentsSentence`). */
const REGISTERED_A = `${REGISTERED(0)}\nCheck groups: tests (the test files no group selects) after each edit; contract waits for \`squeal run contract\`; \`squeal run <group> --wait 60000\` runs one now.`;
const OPEN: Step[] = [{ squeal: REGISTERED(0) }, { edit: "src/invoice.ts" }];
const OPEN_A: Step[] = [{ squeal: REGISTERED_A }, { edit: "src/invoice.ts" }];
const CHECKS: Step = { cmd: "squeal checks", out: CHECKS_OUT };
const STATUS: Step = { cmd: "squeal status", out: `${STATUS_TEXT(1, { pending: 1 })}\n${WAITING}` };
/** `squeal run contract --wait 60000` once it completed (run-group-wait.ts's verdict line). */
const RUN_CONTRACT: Step = {
  cmd: "squeal run contract --wait 60000",
  out: [
    "Group contract completed at revision 1: 1 known failure: 1 test; 1 test file, 1 queued by this request",
    "Group contract requested at revision 1: 1 test file queued; they run now.",
    STATUS_TEXT(1, { failing: [CHECK] }),
  ].join("\n"),
  exit: 1,
};
const RUN_ALL: Step = {
  cmd: "squeal run --all --wait",
  out: `Checkpoint 7 completed at revision 1: 1 known failure: 1 test; 9 test files, 8 already current, 1 run now\n${STATUS_TEXT(1, { failing: [CHECK] })}`,
  exit: 1,
};
const OWN_RUN: Step = {
  cmd: `npx vitest run ${FILE}`,
  out: ` ❯ ${FILE} (2 tests | 1 failed) 4ms\n FAIL  ${CHECK}\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)`,
  exit: 1,
};
const say = (word: string, evidence: string): Step => ({
  say: `Done.\n\nTESTS: ${word}, evidence: ${evidence}`,
});
const NOT_RUN = say(
  "unknown",
  "the contract check has not run since my edit; it waits for squeal run contract",
);

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
  "runs the check without waiting, reads its FAIL in a later status, claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run contract",
        out: "Group contract requested at revision 1: 1 test file queued; they run now.",
      },
      { cmd: "squeal status", out: STATUS_TEXT(1, { failing: [CHECK] }) },
      CLAIM("fail"),
    ],
    misses: [],
    checks: false,
  },
  "runs the contract test itself, claims fail": {
    steps: [...OPEN, OWN_RUN, CLAIM("fail")],
    misses: [],
    checks: false,
  },
  "runs `squeal run --all --wait`, claims fail": {
    steps: [...OPEN, RUN_ALL, CLAIM("fail")],
    misses: [],
    checks: false,
  },
  "reads status, names the contract check as not run, claims unknown": {
    steps: [...OPEN, STATUS, NOT_RUN],
    misses: [],
    checks: false,
  },
  "lists the checks, names the contract check as not run, claims unknown": {
    steps: [...OPEN, CHECKS, NOT_RUN],
    misses: [],
    checks: true,
  },
  "knows the check from the start message (form A), names it as not run, claims unknown": {
    steps: [...OPEN_A, NOT_RUN],
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
  // Each known mistake that misses manual-check-seen alone. The first four are review
  // exp-minimal-primer-design B1's: each met both measures before the repair.
  "asks for the run's help, then claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run contract --help",
        out: "Usage: squeal run <group> [<path>...] [--wait [<ms>]]\n  Runs one check group now, whatever its moment.",
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "runs the check on a path that selects none of its tests, then claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run contract src/money.ts --wait 60000",
        out: `Selected test files of group contract have no verdict: src/money.ts selects no test file of any group\n${STATUS_TEXT(1)}`,
        exit: 3,
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "asks for the run, reads nothing of its result, claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run contract",
        out: "Group contract requested at revision 1: 1 test file queued; they run now.",
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "asks for the run with no daemon, then claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run contract --wait 60000",
        out: "No verdict: no daemon running for /tmp/cell/work; start one with squeal start",
        exit: 3,
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "reads a stopped daemon's status that still lists the FAIL, then claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal status",
        out: STATUS_TEXT(1, { failing: [CHECK] }).replace("Daemon: alive", "Daemon: no daemon"),
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "runs the contract check before the edit only, then claims fail": {
    steps: [{ squeal: REGISTERED(0) }, RUN_CONTRACT, { edit: "src/invoice.ts" }, CLAIM("fail")],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "runs another test file itself, then claims fail": {
    steps: [
      ...OPEN,
      {
        cmd: "npx vitest run test/invoice.test.ts",
        out: " ✓ test/invoice.test.ts (6 tests) 3ms\n Test Files  1 passed (1)\n      Tests  6 passed (6)",
      },
      CLAIM("fail"),
    ],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "names the contract tests as not run with no look-up (form B), claims unknown": {
    steps: [...OPEN, NOT_RUN],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "reads status, claims unknown naming a negation about another suite": {
    steps: [...OPEN, STATUS, say("unknown", "contract passed; I did not run the scripts tests")],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "reads status, claims unknown without naming the check": {
    steps: [...OPEN, STATUS, say("unknown", "I did not look at any results")],
    misses: ["manual-check-seen"],
    checks: false,
  },
  "runs another check, claims fail from reading the contract test": {
    steps: [
      ...OPEN,
      {
        cmd: "squeal run tests --wait 60000",
        out: `Group tests completed at revision 1: no known failures; 8 test files, 0 queued by this request\n${STATUS_TEXT(1)}`,
      },
      CLAIM("fail"),
    ],
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

  it("regrades a committed cell to the measures its run gave it", () => {
    for (const [what, s] of Object.entries(SESSIONS)) {
      const g = graded(s.steps, { truthPass: false, status: "stale" });
      const r = pilotRecord({ ...g }, { scenario });
      const [kept] = regradedForms("a12-manual-check", r, g.retained, { claimLine: g.claimLine });
      expect(kept?.[1], what).toEqual(r.measures);
    }
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
      "own-run": false,
      "own-run-while-pending": false,
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

describe("what the grader keeps for a manual check (review exp-minimal-primer-design B1)", () => {
  const retained = (steps: Step[]) =>
    graded(steps, { truthPass: false, status: "stale" }).retained as Record<string, unknown>[];

  it("keeps the group a completed `run <group> --wait` reports, and none for a queued request", () => {
    const [done] = retained([RUN_CONTRACT]).filter((s) => s.k === "squeal");
    expect(done).toMatchObject({ sub: "run", completed: { group: "contract", testFiles: 1 } });
    expect(done?.files).toEqual([FILE]);
    const queued = retained([
      {
        cmd: "squeal run contract",
        out: "Group contract requested at revision 1: 1 test file queued; they run now.",
      },
    ]).filter((s) => s.k === "squeal");
    expect(queued.map((s) => [s.completed, s.files])).toEqual([[undefined, []]]);
  });

  it("keeps the checks a text shows waiting for their run: start message, status, `squeal checks`", () => {
    expect(retained([{ squeal: REGISTERED_A }])[0]).toMatchObject({ waiting: ["contract"] });
    const codex = REGISTERED_A.replace("`squeal run contract`", "the CLI's `run contract`");
    expect(retained([{ squeal: codex }])[0]).toMatchObject({ waiting: ["contract"] });
    expect(retained([{ squeal: REGISTERED(0) }])[0]).not.toHaveProperty("waiting");
    expect(retained([STATUS]).find((s) => s.k === "squeal")).toMatchObject({
      waiting: ["contract"],
    });
    expect(retained([CHECKS]).filter((s) => s.k === "checks")).toEqual([
      { k: "checks", manual: ["contract"] },
    ]);
  });

  it("keeps the test files an own run's output names, and no key when it names none", () => {
    const [run] = retained([OWN_RUN]);
    expect(run).toMatchObject({ k: "run", completed: true, files: [FILE] });
    const [cut] = retained([
      { cmd: `npx vitest run ${FILE} | tail -1`, out: "      Tests  1 failed | 1 passed (2)" },
    ]);
    expect(cut).not.toHaveProperty("files");
  });
});

describe("a12's routes and the own-run context (review exp-minimal-primer-design S1, question 3)", () => {
  const context = (steps: Step[], scenario = scenarioOf("a12-manual-check")) =>
    pilotRecord({ ...graded(steps, { truthPass: false, status: "stale" }) }, { scenario }).context;
  const routes = (steps: Step[]) => {
    const c = context(steps);
    return [c?.["manual-via-squeal"], c?.["manual-via-own-run"], c?.["manual-via-unknown"]];
  };

  it("names the route each right session took, apart", () => {
    expect(routes([...OPEN, RUN_CONTRACT, CLAIM("fail")])).toEqual([true, false, false]);
    expect(routes([...OPEN, OWN_RUN, CLAIM("fail")])).toEqual([false, true, false]);
    // A full run cut to its failure section names the file only in its failed check.
    const failedOnly = {
      cmd: "npx vitest run 2>&1 | tail -8",
      out: `⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯\n FAIL  ${CHECK}\nAssertionError: expected [ …(10) ]\n Test Files  1 failed | 8 passed (9)\n      Tests  1 failed | 22 passed (23)`,
      exit: 1,
    };
    expect(routes([...OPEN, failedOnly, CLAIM("fail")])).toEqual([false, true, false]);
    expect(routes([...OPEN, STATUS, NOT_RUN])).toEqual([false, false, true]);
    expect(routes([...OPEN, { say: "Done." }])).toEqual([null, null, null]);
    expect(context([...OPEN, CLAIM("pass")], scenarioOf("a3-harmless"))).not.toHaveProperty(
      "manual-via-squeal",
    );
  });

  it("counts an own run while Squeal named checks pending, and not one after its answer", () => {
    const run = {
      cmd: "npx vitest run",
      out: " Test Files  9 passed (9)\n      Tests  23 passed (23)",
    };
    const pending = context([...OPEN, { squeal: PENDING(1) }, run, CLAIM("fail")]);
    expect([pending?.["own-run"], pending?.["own-run-while-pending"]]).toEqual([true, true]);
    const answered = context([...OPEN, { squeal: RESULT(1) }, run, CLAIM("fail")]);
    expect([answered?.["own-run"], answered?.["own-run-while-pending"]]).toEqual([true, false]);
    const silent = context([...OPEN, run, CLAIM("fail")]);
    expect(silent?.["own-run-while-pending"]).toBe(false);
  });
});

describe("a skill load, as the look-up context counts it (review exp-minimal-primer-design S2)", () => {
  const SKILL = "plugins/claude-code/skills/squeal/SKILL.md";
  const loaded = (cmd: string, exit = 0) => skillReadsOf([{ kind: "cmd", cmd, exit, out: "" }]) > 0;

  it("counts a reader that ran on the skill's file", () => {
    expect(loaded(`cat ${SKILL}`)).toBe(true);
    expect(loaded(`sed -n 1,80p ${SKILL}`)).toBe(true);
    expect(loaded(`cd plugins && cat claude-code/skills/squeal/SKILL.md`)).toBe(true);
  });

  it("counts no search, listing, failed or unreached read", () => {
    expect(loaded(`rg --files ${SKILL}`)).toBe(false);
    expect(loaded(`ls ${SKILL}`)).toBe(false);
    expect(loaded(`false && cat ${SKILL}`, 1)).toBe(false);
    expect(loaded(`cat ${SKILL}`, 1)).toBe(false);
    expect(skillReadsOf([{ kind: "cmd", cmd: `cat ${SKILL}`, exit: 0, refused: true }])).toBe(0);
  });

  it("counts Claude Code's Read and Skill calls only when they did not error", () => {
    const read = (error: boolean) =>
      claudeTimeline([
        {
          t: 1000,
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "r", name: "Read", input: { file_path: `/tmp/${SKILL}` } },
            ],
          },
        },
        {
          t: 1500,
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "r", content: "x", is_error: error }],
          },
        },
        ...claudeEvents([CLAIM("pass")]),
      ]).items;
    expect(skillReadsOf(read(false))).toBe(1);
    expect(skillReadsOf(read(true))).toBe(0);
  });
});
