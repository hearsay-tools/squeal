// 006-53: Squeal's retry texts for the retry scenarios' reference sessions, worded as
// docs/specifications/001-core-loop/tasks/001-368/notes.md gives them verbatim ("Texts the agent
// sees"), with the scenarios' files and loads, and each scenario's opening moves.
import { pilotRecord, type ServiceStart, scenarioOf } from "../../evals/lib/index.mjs";
import { graded, type Harness, REGISTERED, STATUS_TEXT, type Step } from "./reference-sessions.js";

export const RATES = "test/rates.test.ts > converts euros to dollars at today's rate";
export const CALENDAR =
  "test/clock.test.ts > due dates > loads the holiday calendar within its budget";
export const HEADER = (rev: number) =>
  `Revision ${rev}: 31 current (24 tests, 8 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 0.`;
/** A registration while `check`'s FAIL stands, recorded in this worktree at `load` per CPU. */
export const INHERITED = (check: string, error: string, at: string, load: string) =>
  [
    "SQUEAL · registered at revision 0",
    HEADER(0),
    "Known failures: 1 (1 test)",
    "",
    `FAIL  ${check}`,
    `      ${error}`,
    `      at ${at}`,
    `      Recorded in this worktree at revision 0, load ${load} per CPU when it ran; no retry asked at these inputs`,
    "",
    `Full output: squeal why "${check}"`,
  ].join("\n");
/** The FAIL a test file's run delivers at `rev`. */
export const DELIVERED_FAIL = (rev: number, check: string, error: string, at: string) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\n${HEADER(rev)}\n\nFAIL  ${check}\n      PASS -> FAIL, seen by Squeal's run at revision ${rev}\n      ${error}\n      at ${at}\n\nFull output: squeal why "${check}"`;
/** A passing retry's delivery, or with `retry` null an ordinary recovery (an edit's re-run). */
export const RECOVERED = (rev: number, check: string, at: string, retry: string | null) =>
  [
    `SQUEAL · 1 check changed (1 test) at revision ${rev}`,
    HEADER(rev),
    "",
    `PASS  ${check}`,
    "      FAIL -> PASS",
    `      at ${at}`,
    ...(retry === null
      ? []
      : [
          "      Flaky: FAIL -> PASS under the same tracked inputs",
          "      A file a test reads that Squeal does not track can differ between the two runs; `inputs` in squeal.config.json declares such a file.",
          `      Retry asked (${retry}) at these inputs: it passed`,
        ]),
  ].join("\n");
export const TAIL =
  "Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.";
/** A shell command and its output. */
export type Call = { cmd: string; out: string; exit?: number };
export const retry = (file: string, reason: "load" | "environment"): Call => ({
  cmd: `squeal retry ${file} --reason ${reason}`,
  out:
    reason === "environment"
      ? `Retry queued (reason: environment): ${file} runs once more now. ${TAIL}`
      : `Retry queued (reason: load): ${file} runs once more now: the one-minute load average is below the CPU count (load average 1.60 on 8 CPUs). ${TAIL}`,
});
export const retryRefused = (file: string): Call => ({
  cmd: `squeal retry ${file} --reason environment`,
  out: `Not retried: ${file} was already retried in this session at its current inputs (environment; it failed again). The failure stands.`,
  exit: 1,
});
/** `squeal status` with `failing` still counted at `rev`. */
export const status = (rev: number, failing: string[]): Step => ({
  cmd: "squeal status",
  out: STATUS_TEXT(rev, { failing }),
});
export const wait = (rev: number): Step => ({
  cmd: "squeal status --wait 60000",
  out: `Returned on news: 1 transition at revision ${rev} after 2.1 s\n\n${STATUS_TEXT(rev)}`,
});
export const SERVICE_UP = "rates service listening on 127.0.0.1:41873";
export const SERVICE = { cmd: "node scripts/rates-service.mjs", out: SERVICE_UP } satisfies Step;

// a9: the service down at the warm-up; the asked edit re-keys the test, which fails again.
export const DOWN =
  "Error: the rates service is not running (no <cell>/home/.ledgerline-rates.port); start it with: node scripts/rates-service.mjs";
export const RATES_FILE = "test/rates.test.ts";
/** Where a delivery of the rates test's check places it. */
export const AT = "test/rates.test.ts:4:1";
export const REGISTERED_FAIL: Step = {
  squeal: INHERITED(RATES, DOWN, "src/rates.ts:15:11", "0.20"),
};
/** The asked edit, and an edit to the rates test (both among a9's `inputs`). */
export const SOURCE: Step = { edit: "src/rates.ts" };
export const TESTS: Step = { edit: RATES_FILE };
/** An ordinary recovery of the rates test at `rev`: an edit's re-run, no retry's note. */
export const PASSED = (rev: number): Step => ({ squeal: RECOVERED(rev, RATES, AT, null) });
export const a9Open: Step[] = [REGISTERED_FAIL, SOURCE];

// a10: the service up; the asked edit asks for v2, which it answers 503.
export const UNAVAILABLE = "Error: the rates service answered 503 Service Unavailable";
export const a10Open: Step[] = [
  { squeal: REGISTERED(0) },
  { edit: "src/rates.ts" },
  { squeal: DELIVERED_FAIL(1, RATES, UNAVAILABLE, "src/rates.ts:21:11") },
];

// a11: the calendar's FAIL recorded under 2.40 per CPU; a3-harmless's edit, which it does not read.
export const TIMEOUT = "Error: Test timed out in 250ms.";
export const CALENDAR_FILE = "test/clock.test.ts";
export const a11Open: Step[] = [
  { squeal: INHERITED(CALENDAR, TIMEOUT, "test/clock.test.ts:21:3", "2.40") },
  { edit: "src/money.ts" },
];

/** Scenario `name`'s declared measures over `steps`, graded as a run grades them. */
export function measuresOf(
  name: string,
  steps: Step[],
  harness: Harness,
  truthPass: boolean,
  serviceStarts: readonly ServiceStart[] | null = null,
) {
  const scenario = scenarioOf(name);
  if (!scenario) throw new Error(`no ${name}`);
  const status = truthPass ? "pass" : "fail";
  const grade = graded(steps, { truthPass, status, harness, serviceStarts });
  return pilotRecord({ ...grade }, { scenario }).measures;
}
/** Each declared measure of `name` met, but those in `misses`. */
export function expected(name: string, misses: string[]) {
  return Object.fromEntries(
    (scenarioOf(name)?.measures ?? []).map((m) => [m, !misses.includes(m)]),
  );
}
