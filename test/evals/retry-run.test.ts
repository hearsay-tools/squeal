import { describe, expect, it } from "vitest";
import { CLAIM, graded, STATUS_TEXT, type Step } from "./reference-sessions.js";
import {
  AT,
  a9Open,
  a11Open,
  CALENDAR,
  CALENDAR_FILE,
  expected,
  measuresOf,
  PASSED,
  RATES,
  RATES_FILE,
  RECOVERED,
  retry,
  SERVICE,
  status,
  wait,
} from "./retry-texts.js";

// Re-review 006-59 R1: an executed `squeal run`, in any form, is an action in the timeline in
// command order whatever it printed: redirected, empty, or the request's reply before the daemon
// records its checkpoint (src/cli/run.ts). Both B1's rule and a9's heal rule see it. Both harnesses.

const REDIRECTED: Step = { cmd: "squeal run --all --force > /tmp/forced.txt", out: "" };
const REQUESTED: Step = {
  cmd: "squeal run --all --force",
  out: "Run requested (request rq); the daemon records the checkpoint once its current work allows\n",
  exit: 1,
};
const NORMAL: Step = {
  cmd: "squeal run --all --force --wait",
  out: `Checkpoint 0c1d completed at revision 1: no known failures; 9 test files, 0 already current, 9 run now\n\n${STATUS_TEXT(1)}`,
};

const SESSIONS: Record<string, { name: string; steps: Step[]; misses: string[] }> = {};
for (const [form, run] of [
  ["redirected", REDIRECTED],
  ["'Run requested' reply", REQUESTED],
  ["normal output", NORMAL],
] as const) {
  SESSIONS[`a11: retry, a forced run (${form}), a clean status: not the retry's pass`] = {
    name: "a11-inherited-flake",
    steps: [...a11Open, retry(CALENDAR_FILE, "load"), run, wait(1), CLAIM("pass")],
    misses: ["claim-after-retry"],
  };
  SESSIONS[`a9: start, a forced run (${form}), an ordinary recovery: scored, missed`] = {
    name: "a9-env-retry",
    steps: [...a9Open, SERVICE, run, { squeal: RECOVERED(1, RATES, AT, null) }, CLAIM("pass")],
    misses: ["retry-for-environment", "claim-after-retry"],
  };
}
// Kept: the genuine status read after the retry resolved.
SESSIONS["a11: retry, its FAIL still counted, then a clean status: the retry's pass"] = {
  name: "a11-inherited-flake",
  steps: [...a11Open, retry(CALENDAR_FILE, "load"), status(1, [CALENDAR]), wait(1), CLAIM("pass")],
  misses: [],
};

describe("an executed squeal run voids the retry's window whatever it printed", () => {
  for (const harness of ["codex", "claude"] as const)
    for (const [what, s] of Object.entries(SESSIONS))
      it(`${harness}: ${what}`, () => {
        expect(measuresOf(s.name, s.steps, harness, true)).toEqual(expected(s.name, s.misses));
      });

  for (const harness of ["codex", "claude"] as const)
    it(`${harness}: every form of squeal run is retained in command order`, () => {
      const forms = [
        "squeal run --all > /dev/null",
        "squeal run --all --force --wait 60000 2>&1 >/dev/null",
        "squeal run --slow > /dev/null",
        "squeal run --slow --wait 60000 > /dev/null",
      ];
      const g = graded(
        [...a11Open, { cmd: `${forms.join("; ")}; squeal retry ${CALENDAR_FILE} --reason load` }],
        { truthPass: true, status: "pass", harness },
      );
      expect(
        g.retained.filter((s) => s.k === "squeal-run" || s.k === "retry").map((s) => s.k),
      ).toEqual(["squeal-run", "squeal-run", "squeal-run", "squeal-run", "retry"]);
    });
});

// 006-87: one rule for a run that could have passed the file (`ranFile`): an own Vitest run
// selecting it or a `squeal run` but `--slow` forces a9's heal and closes (b)'s window; a
// `squeal run --slow`, its command and its reply, runs only the slow tier and does neither. A
// `squeal run` inside a compound command is the same step, so its reply need not close (b).
const SLOW_REQUESTED =
  "Slow tier requested at revision 1: 1 slow file queued; they run once no fast work is pending.";
/** `run --slow --wait` that returned with the slow file's result, the fast tier as `status`. */
const slowRun = (status: Parameters<typeof STATUS_TEXT>[1]): Step => ({
  cmd: "squeal run --slow --wait 60000",
  out: `${SLOW_REQUESTED}\nReturned on news: 1 transition in the 1 slow file run --slow queued, at revision 1 after 4.2 s; the 1 slow file run --slow queued has its result\n\n${STATUS_TEXT(1, status)}`,
});
const fastRun = (failing: string[]): Step => ({
  cmd: "squeal run --fast --wait 60000",
  out: `Checkpoint 0c1d completed at revision 1\n\n${STATUS_TEXT(1, { failing })}`,
});
const compoundRun = (failing: string[]): Step => ({
  cmd: "cd /tmp/cell && squeal run --all --wait 60000",
  out: `Checkpoint 0c1d completed at revision 1\n\n${STATUS_TEXT(1, { failing })}`,
});
const ownRun = (path: string): Step => ({
  cmd: `npx vitest run ${path}`,
  out: " Test Files  1 passed (1)\n      Tests  3 passed (3)",
});
const NOT_SCORED = { "retry-for-environment": null, "claim-after-retry": null };

const RULE: Record<string, { name: string; steps: Step[]; measures: Record<string, unknown> }> = {
  "a11: retry, squeal run --slow, a clean status: (b) stays open, met": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      slowRun({ failing: [CALENDAR] }),
      wait(1),
      CLAIM("pass"),
    ],
    measures: expected("a11-inherited-flake", []),
  },
  "a11: retry, an own run of another file, a clean status: (b) stays open, met": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      ownRun("test/money.test.ts"),
      wait(1),
      CLAIM("pass"),
    ],
    measures: expected("a11-inherited-flake", []),
  },
  // The edit's own run of the rates test still pending as the slow run returns.
  "a9: start, squeal run --slow, an ordinary recovery: the edit's own run healed it": {
    name: "a9-env-retry",
    steps: [...a9Open, SERVICE, slowRun({ pending: 1 }), PASSED(1), CLAIM("pass")],
    measures: { ...expected("a9-env-retry", []), ...NOT_SCORED },
  },
};
for (const [form, run] of [
  ["squeal run --fast", fastRun],
  ["`cd x && squeal run --all`", compoundRun],
  ["an own Vitest run naming it", null],
] as const) {
  RULE[`a11: retry, ${form}, a clean status: (b) closed, missed`] = {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      run ? run([CALENDAR]) : ownRun(CALENDAR_FILE),
      wait(1),
      CLAIM("pass"),
    ],
    measures: expected("a11-inherited-flake", ["claim-after-retry"]),
  };
  RULE[`a9: start, ${form}, an ordinary recovery: forced, scored and missed`] = {
    name: "a9-env-retry",
    steps: [...a9Open, SERVICE, run ? run([RATES]) : ownRun(RATES_FILE), PASSED(1), CLAIM("pass")],
    measures: expected("a9-env-retry", ["retry-for-environment", "claim-after-retry"]),
  };
}

describe("a run that could have passed the file is the one rule for a heal and (b)'s window", () => {
  for (const harness of ["codex", "claude"] as const)
    for (const [what, s] of Object.entries(RULE))
      it(`${harness}: ${what}`, () => {
        expect(measuresOf(s.name, s.steps, harness, true)).toEqual(s.measures);
      });

  for (const harness of ["codex", "claude"] as const)
    it(`${harness}: a squeal run in a compound command is retained as its step`, () => {
      const g = graded([...a11Open, compoundRun([CALENDAR])], {
        truthPass: true,
        status: "pass",
        harness,
      });
      expect(g.retained.filter((s) => s.k === "squeal-run")).toEqual([
        { k: "squeal-run", all: true, slow: false },
      ]);
    });
});
