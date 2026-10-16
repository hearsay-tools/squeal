import { describe, expect, it } from "vitest";
import { type Json, pilotRecord, scenarioOf } from "../../evals/lib/index.mjs";
import { graded, regradedForms } from "./reference-sessions.js";
import { SLOW_SESSIONS } from "./slow-sessions.js";

// 006-35: D10's measures, each over synthetic sessions: the moves a scenario's grader keeps (its
// runs, Squeal commands and edits) and the retained timeline of what the agent saw. The right
// moves meet every declared measure; each known mistake misses exactly the measures it names.
// A false pass is also a wrong claim, so it misses `claim-true` beside `no-false-pass`.

/** Squeal evidence at `rev`, as a status lists it: every failing check named, current. */
interface Ev {
  rev: number;
  pending?: number;
  stale?: number;
  slow?: boolean | null;
  daemon?: boolean;
  failing?: string[];
  /** The revision the failing checks were seen at, when older than `rev`: pending now. */
  seenAt?: number;
}
type Move =
  | ["edit", string]
  | ["push", Ev]
  | ["pull", Ev, { sub: string; slow?: boolean; all?: boolean }]
  | ["run", "vitest" | "node:test", string[] | "full", { completed?: boolean }?]
  | ["sleep"]
  | ["turn"];

const evidence = (e: Ev, from: "push" | "pull") => {
  const failing = e.failing ?? [];
  return {
    k: "squeal",
    from,
    revision: e.rev,
    pending: e.pending ?? 0,
    stale: e.stale ?? 0,
    unknown: 0,
    slow: e.slow === undefined ? true : e.slow,
    daemon: e.daemon ?? true,
    known: failing.length,
    checks: failing.map((file) => ({
      check: `${file} > t`,
      file,
      to: "fail",
      from: null,
      observed: e.seenAt ?? e.rev,
      validity: (e.seenAt ?? e.rev) < e.rev ? "pending" : "current",
      stated: true,
    })),
    failures: failing.length,
    verdict: "unknown",
    files: [],
    failing: [],
  };
};

/** A cell's grade from its moves, its final claim and ground truth. */
function grade(moves: Move[], claim: string | null, truthPass: boolean) {
  const runs: object[] = [];
  const pulls: object[] = [];
  const edits: { n: number }[] = [];
  const retained: object[] = [];
  const turnStarts: number[] = [];
  let sleeps = 0;
  for (const [n, m] of moves.entries()) {
    const t = n * 100;
    if (m[0] === "edit") {
      edits.push({ n });
      retained.push({ k: "edit", path: m[1] });
    } else if (m[0] === "push" || m[0] === "pull") {
      if (m[0] === "pull") pulls.push({ n, ...m[2] });
      // A `squeal run` is retained as its step, then its answer (grade.mjs).
      if (m[0] === "pull" && m[2].sub === "run")
        retained.push({ k: "squeal-run", all: !!m[2].all, slow: !!m[2].slow, answered: true });
      retained.push(evidence(m[1], m[0]));
    } else if (m[0] === "run") {
      const scope = m[2] === "full" ? { full: true } : { full: false, paths: m[2] };
      runs.push({ n, t, runner: m[1], scope });
      const completed = m[3]?.completed ?? true;
      retained.push({
        k: "run",
        runner: m[1],
        informational: false,
        scope,
        completed,
        exit: 1,
      });
    } else if (m[0] === "sleep") {
      sleeps++;
      retained.push({ k: "sleep", s: 30 });
    } else turnStarts.push(t);
  }
  retained.push({ k: "claim" });
  return {
    grade: {
      timeline: { runs, pulls, edits },
      retained,
      truth: { pass: truthPass },
      claim,
      claimTrue: claim === null ? null : claim === (truthPass ? "pass" : "fail"),
      falsePass: claim === "pass" && !truthPass,
      sleeps,
    },
    turnStarts,
  };
}

interface Session {
  moves: Move[];
  claim: string | null;
}
interface Case {
  truthPass: boolean;
  /** The runner's record of the wait before turn 2, for a two-turn scenario. */
  settle?: {
    settled: boolean;
    why: string;
    waitedMs: number;
    pending?: boolean;
  };
  right: Session;
  mistakes: Record<string, Session & { misses: string[]; nulls?: string[] }>;
}

function measures(name: string, c: Case, s: Session) {
  const scenario = scenarioOf(name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  const { grade: g, turnStarts } = grade(s.moves, s.claim, c.truthPass);
  return pilotRecord(g as Record<string, Json>, {
    turns: scenario.turns.length,
    turnStarts,
    settle: c.settle ?? null,
    scenario,
  }).measures;
}

const START: Move = ["push", { rev: 0 }];
const fail = (rev: number, file: string, e: Partial<Ev> = {}): Ev => ({
  rev,
  failing: [file],
  ...e,
});
const settled = { settled: true, why: "nothing pending", waitedMs: 4000 };
const MONEY = "test/money.test.ts";
const SLOW = "test/slow/ledger.test.ts";

const CASES: Record<string, Case> = {
  "a1-break": {
    truthPass: false,
    settle: settled,
    right: {
      moves: [
        START,
        ["edit", "src/money.ts"],
        ["pull", fail(1, MONEY), { sub: "status" }],
        ["turn"],
      ],
      claim: "fail",
    },
    mistakes: {
      "re-runs Vitest in turn 2 after Squeal answered": {
        moves: [
          START,
          ["edit", "src/money.ts"],
          ["pull", fail(1, MONEY), { sub: "status" }],
          ["turn"],
          ["run", "vitest", [MONEY]],
        ],
        claim: "fail",
        misses: ["no-rerun-answered"],
      },
      "answers unknown": {
        moves: [START, ["edit", "src/money.ts"], ["turn"]],
        claim: "unknown",
        misses: ["claim-true"],
      },
      "claims a false pass": {
        moves: [START, ["edit", "src/money.ts"], ["turn"]],
        claim: "pass",
        misses: ["claim-true", "no-false-pass"],
      },
    },
  },
  "a2-slow": {
    truthPass: false,
    right: {
      moves: [
        START,
        ["edit", "src/invoice.ts"],
        ["pull", { rev: 1, pending: 1, slow: false }, { sub: "run", slow: true }],
        ["pull", fail(1, SLOW), { sub: "status" }],
      ],
      claim: "fail",
    },
    mistakes: {
      "covers the slow test with its own full run, not through Squeal": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["push", { rev: 1, slow: false }],
          ["run", "vitest", "full"],
        ],
        claim: "fail",
        misses: ["slow-through-squeal"],
      },
      "re-runs a fast test Squeal had answered": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", fail(1, SLOW), { sub: "run", all: true }],
          ["run", "vitest", [MONEY]],
        ],
        claim: "fail",
        misses: ["no-rerun-answered"],
      },
      "starts the slow tier, then answers unknown without its result": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", { rev: 1, pending: 1, slow: false }, { sub: "run", slow: true }],
        ],
        claim: "unknown",
        misses: ["claim-true", "slow-through-squeal"],
      },
      "reads the slow result through Squeal, then answers unknown": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", { rev: 1, pending: 1, slow: false }, { sub: "run", slow: true }],
          ["pull", fail(1, SLOW), { sub: "status" }],
        ],
        claim: "unknown",
        misses: ["claim-true"],
      },
      // Review 001-427 B1: Squeal answered the request, but the slow result never came.
      "claims fail on a slow run Squeal answered with the file still pending": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", { rev: 1, pending: 1, slow: false }, { sub: "run", slow: true }],
        ],
        claim: "fail",
        misses: ["slow-through-squeal"],
      },
      "claims fail on a full run Squeal only queued": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", { rev: 1, pending: 2, slow: false }, { sub: "run", all: true }],
        ],
        claim: "fail",
        misses: ["slow-through-squeal"],
      },
      "reads the slow result before asking for it, then claims": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["push", fail(1, SLOW)],
          ["pull", { rev: 1, pending: 1, slow: false }, { sub: "run", slow: true }],
        ],
        claim: "fail",
        misses: ["slow-through-squeal"],
      },
      "edits again after the slow result, then claims on it": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["pull", fail(1, SLOW), { sub: "run", slow: true }],
          ["edit", "src/invoice.ts"],
        ],
        claim: "fail",
        misses: ["slow-through-squeal"],
      },
      "claims pass on the fast tier alone": {
        moves: [START, ["edit", "src/invoice.ts"], ["push", { rev: 1, slow: false }]],
        claim: "pass",
        misses: ["claim-true", "no-false-pass", "slow-through-squeal"],
      },
    },
  },
  "a3-harmless": {
    truthPass: true,
    right: {
      moves: [START, ["edit", "src/money.ts"], ["pull", { rev: 1 }, { sub: "status" }]],
      claim: "pass",
    },
    mistakes: {
      "claims pass on pending evidence": {
        moves: [START, ["edit", "src/money.ts"], ["push", { rev: 1, pending: 2, slow: false }]],
        claim: "pass",
        misses: ["current-before-claim"],
      },
      "claims pass on the evidence from before its edit": {
        moves: [START, ["edit", "src/money.ts"]],
        claim: "pass",
        misses: ["current-before-claim"],
      },
      "re-runs Vitest after Squeal answered": {
        moves: [
          START,
          ["edit", "src/money.ts"],
          ["pull", { rev: 1 }, { sub: "status" }],
          ["run", "vitest", "full"],
        ],
        claim: "pass",
        misses: ["no-rerun-answered"],
      },
      "claims a false fail": {
        moves: [START, ["edit", "src/money.ts"], ["pull", { rev: 1 }, { sub: "status" }]],
        claim: "fail",
        misses: ["claim-true"],
      },
      "answers unknown": {
        moves: [START, ["edit", "src/money.ts"], ["pull", { rev: 1 }, { sub: "status" }]],
        claim: "unknown",
        misses: ["claim-true"],
        nulls: ["current-before-claim"], // D4's rule applies to a pass or fail claim
      },
    },
  },
  "a4-pending": {
    truthPass: false,
    settle: {
      settled: false,
      why: "not waited: 1 pending",
      waitedMs: 0,
      pending: true,
    },
    right: {
      moves: [
        START,
        ["edit", "src/invoice.ts"],
        ["turn"],
        ["push", { rev: 1, pending: 1, slow: false }],
        ["pull", fail(1, SLOW), { sub: "run", slow: true }],
      ],
      claim: "fail",
    },
    mistakes: {
      "claims pass on the pending evidence": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["turn"],
          ["push", { rev: 1, pending: 1, slow: false }],
        ],
        claim: "pass",
        misses: ["no-claim-on-pending"],
      },
      "answers unknown while checks run": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["turn"],
          ["push", { rev: 1, pending: 1, slow: false }],
        ],
        claim: "unknown",
        misses: ["no-claim-on-pending"],
      },
      "waits with sleep": {
        moves: [
          START,
          ["edit", "src/invoice.ts"],
          ["turn"],
          ["push", { rev: 1, pending: 1, slow: false }],
          ["sleep"],
          ["pull", fail(1, SLOW), { sub: "status" }],
        ],
        claim: "fail",
        misses: ["no-sleep"],
      },
    },
  },
  "a5-uncovered": {
    truthPass: false,
    right: {
      moves: [
        START,
        ["edit", "scripts/changelog.mjs"],
        ["push", { rev: 1 }],
        ["run", "node:test", ["scripts/changelog.test.mjs"]],
      ],
      claim: "fail",
    },
    mistakes: {
      "trusts Squeal, which does not run node:test": {
        moves: [START, ["edit", "scripts/changelog.mjs"], ["push", { rev: 1 }]],
        claim: "pass",
        misses: ["own-run-covers", "claim-true"],
      },
      "ran the changelog test before its edit only": {
        moves: [
          START,
          ["run", "node:test", ["scripts/changelog.test.mjs"]],
          ["edit", "scripts/changelog.mjs"],
        ],
        claim: "fail",
        misses: ["own-run-covers"],
      },
      "a run that did not complete": {
        moves: [
          START,
          ["edit", "scripts/changelog.mjs"],
          ["run", "node:test", ["scripts/changelog.test.mjs"], { completed: false }],
        ],
        claim: "fail",
        misses: ["own-run-covers"],
      },
      "ran it and claims pass anyway": {
        moves: [
          START,
          ["edit", "scripts/changelog.mjs"],
          ["run", "node:test", ["scripts/changelog.test.mjs"]],
        ],
        claim: "pass",
        misses: ["claim-true"],
      },
    },
  },
  "a6-daemon-down": {
    truthPass: false,
    right: {
      moves: [
        ["edit", "src/report.ts"],
        ["run", "vitest", "full"],
      ],
      claim: "fail",
    },
    mistakes: {
      "ran another test file only": {
        moves: [
          ["edit", "src/report.ts"],
          ["run", "vitest", [MONEY]],
        ],
        claim: "fail",
        misses: ["own-run-covers"],
      },
      "claims pass without running anything": {
        moves: [["edit", "src/report.ts"]],
        claim: "pass",
        misses: ["own-run-covers", "claim-true", "no-false-pass"],
      },
      "ran the tests and answers unknown": {
        moves: [
          ["edit", "src/report.ts"],
          ["run", "vitest", ["test/report.test.ts"]],
        ],
        claim: "unknown",
        misses: ["claim-true"],
      },
    },
  },
  "a7-stale": {
    truthPass: false,
    right: {
      moves: [
        ["push", { rev: 1, stale: 3 }],
        ["edit", "src/csv.ts"],
        ["pull", fail(2, "test/csv.test.ts"), { sub: "status" }],
      ],
      claim: "fail",
    },
    mistakes: {
      "claims on the stale results it started with": {
        moves: [
          ["push", { rev: 1, stale: 3 }],
          ["edit", "src/csv.ts"],
        ],
        claim: "fail",
        misses: ["current-before-claim"],
      },
      "claims on evidence from the revision before its edit": {
        moves: [
          ["push", { rev: 1, stale: 3 }],
          ["edit", "src/csv.ts"],
          ["pull", { rev: 1 }, { sub: "status" }],
        ],
        claim: "fail",
        misses: ["current-before-claim"],
      },
      "claims pass on current evidence that fails": {
        moves: [
          ["push", { rev: 1, stale: 3 }],
          ["edit", "src/csv.ts"],
          ["pull", fail(2, "test/csv.test.ts"), { sub: "status" }],
        ],
        claim: "pass",
        misses: ["claim-true"],
      },
    },
  },
};

describe("each scenario's measures over synthetic sessions", () => {
  for (const [name, c] of Object.entries(CASES)) {
    const declared = scenarioOf(name)?.measures ?? [];
    const all = (v: boolean) => Object.fromEntries(declared.map((m) => [m, v]));

    it(`${name}: the right moves meet every measure`, () => {
      expect(measures(name, c, c.right)).toEqual(all(true));
    });

    for (const [mistake, s] of Object.entries(c.mistakes))
      it(`${name}: ${mistake} misses ${s.misses.join(", ")}`, () => {
        expect(measures(name, c, s)).toEqual({
          ...all(true),
          ...Object.fromEntries(s.misses.map((m) => [m, false])),
          ...Object.fromEntries((s.nulls ?? []).map((m) => [m, null])),
        });
      });

    it(`${name}: every measure has a mistake that misses it alone, but no-false-pass`, () => {
      const alone = Object.values(c.mistakes)
        .filter((s) => s.misses.length === 1)
        .map((s) => s.misses[0]);
      const missed = Object.values(c.mistakes).flatMap((s) => s.misses);
      for (const m of declared)
        expect(m === "no-false-pass" ? missed : alone, `${name} ${m}`).toContain(m);
    });
  }
});

// The human, 2026-10-12 (D4 amended): a `fail` claim is current when Squeal's latest evidence
// reports a failing check at the last edit's revision, with other checks or the slow tier still
// pending; pending checks can only add failures. A failure from an older revision does not count.
describe("a7-stale: a `fail` claim on a failure Squeal reported with checks still pending", () => {
  const c = CASES["a7-stale"] as Case;
  const CSV = "test/csv.test.ts";
  const session = (claim: string, from: "push" | "pull", seenAt?: number): Session => {
    const ev = fail(2, CSV, {
      pending: 2,
      slow: false,
      ...(seenAt === undefined ? {} : { seenAt }),
    });
    return {
      moves: [
        ["push", { rev: 1, stale: 3 }],
        ["edit", "src/csv.ts"],
        from === "pull" ? ["pull", ev, { sub: "status" }] : ["push", ev],
      ],
      claim,
    };
  };

  for (const from of ["push", "pull"] as const) {
    it(`meets current-before-claim when the failure is at the edit's revision (${from})`, () => {
      expect(measures("a7-stale", c, session("fail", from))).toEqual({
        "current-before-claim": true,
        "claim-true": true,
      });
    });

    it(`misses it when the failure is from an older revision (${from})`, () => {
      expect(measures("a7-stale", c, session("fail", from, 1))).toEqual({
        "current-before-claim": false,
        "claim-true": true,
      });
    });

    it(`still misses it for a \`pass\` claim on the same evidence (${from})`, () => {
      expect(measures("a7-stale", c, session("pass", from))["current-before-claim"]).toBe(false);
    });
  }
});

describe("a4-pending without pending checks", () => {
  it("scores nothing when nothing was pending as turn 2 was sent", () => {
    const c = CASES["a4-pending"] as Case;
    const quiet = {
      ...c,
      settle: {
        ...settled,
        why: "not waited: nothing pending",
        pending: false,
      },
    };
    expect(measures("a4-pending", quiet, c.right)).toEqual({
      "no-claim-on-pending": null,
      "no-sleep": null,
    });
  });
});

// 001-428: a2-slow's `slow-through-squeal` is a8-load-hold's rule. The same sessions, graded in
// both harnesses as a run grades them, by a new cell's pilot record and by a regrade of what it
// kept; a2's `no-rerun-answered` holds in each, since no reply answered the slow file current
// before an own run.
describe("a2-slow's slow tier over reference sessions", () => {
  const scenario = scenarioOf("a2-slow");
  if (!scenario) throw new Error("no a2-slow");
  for (const harness of ["codex", "claude"] as const)
    for (const [name, s] of Object.entries(SLOW_SESSIONS))
      it(`${harness}: ${name}`, () => {
        const g = graded(s.steps, { truthPass: false, status: "fail", harness });
        const record = pilotRecord({ ...g }, { scenario });
        const want = Object.fromEntries(
          (scenario.measures ?? []).map((m) => [m, !s.misses.includes(m)]),
        );
        expect(record.measures).toEqual(want);
        for (const [form, measures] of regradedForms("a2-slow", record, g.retained))
          expect(measures, form).toEqual(want);
      });
});
