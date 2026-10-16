import { describe, expect, it } from "vitest";
import { pilotRecord, scenarioOf } from "../../evals/lib/index.mjs";
import {
  CLAIM,
  graded,
  type Harness,
  REGISTERED,
  STATUS_TEXT,
  type Step,
} from "./reference-sessions.js";
import { a11Open, CALENDAR_FILE, expected, measuresOf, retry, wait } from "./retry-texts.js";

// 006-62, finding 2: a Squeal command Squeal never answered is no Squeal action. In the a8 run
// every Sonnet cell's `squeal run --slow` got the host launcher's reply (finding 1), and
// `slow-through-squeal` credited it. Only a command Squeal answered counts as a pull, a wait or
// the slow tier run through Squeal; an executed `squeal run` still voids a retry's window
// (re-review 006-59 R1). Both harnesses.

/** The host's `~/.local/bin/squeal` (format 3), as the pilot's Claude cells got it. */
const LAUNCHER =
  "squeal: no squeal@hearsay plugin is installed in Claude Code or Codex. Install it:\n  claude plugin marketplace add hearsay-tools/marketplace && claude plugin install squeal@hearsay\n  codex plugin marketplace add hearsay-tools/marketplace && codex plugin add squeal@hearsay\nor run install.sh as https://github.com/hearsay-tools/squeal#install shows.\n";
/** Format 4's wording (plugins/claude-code/bin/squeal-launcher). */
const LAUNCHER_4 =
  "squeal: no squeal@hearsay plugin is installed in Claude Code or Codex, and no Squeal package in Pi or OpenCode. Install it:\n  claude plugin marketplace add hearsay-tools/marketplace && claude plugin install squeal@hearsay\n";

const SLOW = "test/slow/ledger.test.ts > the year's ledger reconciles with the invoices";
const VITEST_OUT = `FAIL  ${SLOW}\n Test Files  1 failed | 6 passed (7)\n      Tests  1 failed | 22 passed (23)`;
/** 001-428: the slow tier's result current, which the slow run's credit needs. */
const SLOW_CURRENT = "Slow tier: 1 test file; 1 current against src/** as of revision 1.";
const OWN_RUN: Step = { cmd: "npx vitest run", out: VITEST_OUT, exit: 1 };
const OPENING: Step[] = [{ squeal: REGISTERED(0) }, { edit: "src/invoice.ts" }];

const UNANSWERED: Record<string, Step> = {
  // The a8 Sonnet cells' call, verbatim.
  "the host launcher's reply, twice": {
    cmd: "squeal status --wait 60000; squeal run --slow --wait 60000",
    out: `${LAUNCHER}${LAUNCHER}`,
    exit: 1,
  },
  "format 4's launcher reply": {
    cmd: "squeal run --slow --wait 60000",
    out: LAUNCHER_4,
    exit: 1,
  },
  "the shell's command not found": {
    cmd: "squeal run --slow --wait 60000",
    out: "/bin/bash: line 1: squeal: command not found\n",
    exit: 127,
  },
  "exit 1 with no Squeal header": {
    cmd: "node /tmp/cell/pin/dist/cli/squeal.mjs run --slow --wait 60000",
    out: "node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: something else went wrong\n",
    exit: 1,
  },
};

const a8 = (steps: Step[], harness: Harness) => {
  const scenario = scenarioOf("a8-load-hold");
  if (!scenario) throw new Error("no a8-load-hold");
  const g = graded(steps, { truthPass: false, status: "fail", harness });
  return { g, measures: pilotRecord({ ...g }, { scenario }).measures };
};

describe("a Squeal command Squeal never answered", () => {
  for (const harness of ["codex", "claude"] as const) {
    for (const [what, call] of Object.entries(UNANSWERED))
      it(`${harness}: ${what} is no pull, wait or slow run through Squeal`, () => {
        const { g, measures } = a8([...OPENING, call, OWN_RUN, CLAIM("fail")], harness);
        expect(g.squealPulls).toBe(0);
        expect(g.squealWaits).toBe(0);
        expect(g.squealRunSlow).toBe(0);
        expect(g.waitsAfterLastEdit).toBe(0);
        expect(measures["slow-through-squeal"]).toBe(false);
        // R1: an executed run stays an action of the timeline, kept as one Squeal never answered.
        expect(g.retained.filter((s) => s.k === "squeal-run")).toEqual([
          { k: "squeal-run", all: false, slow: true, answered: false },
        ]);
      });

    it(`${harness}: one answered call beside an unanswered one counts once`, () => {
      const answered: Step = {
        cmd: "node /tmp/cell/pin/dist/cli/squeal.mjs run --slow --wait 60000",
        out: `Slow tier requested at revision 1: 1 slow file queued; they run once no fast work is pending.\nReturned on news: 1 transition at revision 1 after 3.0 s\n\nRevision: 1\nKnown failures: 1\n${SLOW_CURRENT}\n`,
        exit: 1,
      };
      const { g, measures } = a8(
        [...OPENING, UNANSWERED["format 4's launcher reply"] as Step, answered, CLAIM("fail")],
        harness,
      );
      expect(g.squealRunSlow).toBe(1);
      expect(measures["slow-through-squeal"]).toBe(true);
    });

    it(`${harness}: an unanswered run still voids a retry's window (R1)`, () => {
      const run: Step = { cmd: "squeal run --all --force", out: LAUNCHER, exit: 1 };
      const steps = [...a11Open, retry(CALENDAR_FILE, "load"), run, wait(1), CLAIM("pass")];
      expect(measuresOf("a11-inherited-flake", steps, harness, true)).toEqual(
        expected("a11-inherited-flake", ["claim-after-retry"]),
      );
    });
  }
});

// Review 006-63 B2: one call can mix the pinned CLI's absolute path and a bare `squeal`, in
// either order. Each foreign reply is the command's whose CLI could print it, so the answered
// status is the pull and the unanswered slow run is none; when two CLIs could have printed the
// reply, neither command gets a pull, a wait or the slow run by its position.
const PIN = "node /tmp/pin/dist/cli/squeal.mjs";
const STATUS = `Returned on quiet: nothing pending at revision 1 after 4.0 s\n\n${STATUS_TEXT(1, { failing: [SLOW] })}\n${SLOW_CURRENT}\n`;
const SLOW_RUN = "run --slow --wait 60000";

describe("one call's Squeal commands, each with its own reply", () => {
  for (const harness of ["codex", "claude"] as const) {
    it.each([
      [
        "the pin's status, then a bare slow run",
        `${PIN} status --wait 60000; squeal ${SLOW_RUN}`,
        `${STATUS}${LAUNCHER}`,
      ],
      [
        "a bare slow run, then the pin's status",
        `squeal ${SLOW_RUN}; ${PIN} status --wait 60000`,
        `${LAUNCHER}${STATUS}`,
      ],
    ])(`${harness}: %s credits the status alone`, (_, cmd, out) => {
      const { g, measures } = a8([...OPENING, { cmd, out, exit: 1 }, CLAIM("fail")], harness);
      expect(g.timeline.pulls.map((p) => p.sub)).toEqual(["status"]);
      expect(g.squealWaits).toBe(1);
      expect(g.squealRunSlow).toBe(0);
      expect(measures["slow-through-squeal"]).toBe(false);
      expect(g.retained.filter((s) => s.k === "squeal-run")).toHaveLength(1);
      expect(g.retained.flatMap((s) => (s.k === "squeal" ? [s.sub] : []))).toContain("status");
    });

    it(`${harness}: the pin's slow run beside a bare unanswered status is the slow run`, () => {
      const call = {
        cmd: `squeal status --wait 60000; ${PIN} ${SLOW_RUN}`,
        out: `${LAUNCHER}${STATUS}`,
        exit: 1,
      };
      const { g, measures } = a8([...OPENING, call, CLAIM("fail")], harness);
      expect(g.timeline.pulls.map((p) => p.sub)).toEqual(["run"]);
      expect(g.squealRunSlow).toBe(1);
      expect(measures["slow-through-squeal"]).toBe(true);
    });

    it(`${harness}: Node's missing file is the command that named it`, () => {
      const missing = "Error: Cannot find module '/tmp/pin/dist/cli/squeal.mjs'\n";
      const call = {
        cmd: `${PIN} ${SLOW_RUN}; squeal status --wait 60000`,
        out: `${missing}${STATUS}`,
        exit: 1,
      };
      const { g } = a8([...OPENING, call, CLAIM("fail")], harness);
      expect(g.timeline.pulls.map((p) => p.sub)).toEqual(["status"]);
      expect(g.squealRunSlow).toBe(0);
    });

    it(`${harness}: a reply two CLIs could print credits neither by position`, () => {
      const cmd = `squeal status --wait 60000; /home/dev/.local/bin/squeal ${SLOW_RUN}`;
      const { g, measures } = a8(
        [...OPENING, { cmd, out: `${STATUS}${LAUNCHER}`, exit: 1 }, CLAIM("fail")],
        harness,
      );
      expect(g.squealPulls).toBe(0);
      expect(g.squealWaits).toBe(0);
      expect(g.squealRunSlow).toBe(0);
      expect(measures["slow-through-squeal"]).toBe(false);
      // R1: the run stays; the Squeal text the agent read stays once, as a run's.
      expect(g.retained.filter((s) => s.k === "squeal-run")).toHaveLength(1);
      expect(
        g.retained.flatMap((s) => (s.k === "squeal" && s.from === "pull" ? [s.sub] : [])),
      ).toEqual(["run"]);
    });
  }
});
