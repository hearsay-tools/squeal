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
  RATES,
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
