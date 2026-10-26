import { describe, expect, it } from "vitest";
import { CLAIM, STATUS_TEXT, type Step } from "./reference-sessions.js";
import {
  a9Open,
  a11Open,
  CALENDAR,
  CALENDAR_FILE,
  expected,
  measuresOf,
  RATES,
  RATES_FILE,
  retry,
  SERVICE,
  status,
  wait,
} from "./retry-texts.js";

// Review 006-57 B1: `claim-after-retry` credits only the retry's pass, as the coordinator ruled:
// a delivered pass with `Retry asked (…) at these inputs: it passed`, or a current, settled
// status read after the queued retry with the file in no known failure and no pending retry,
// nothing between that could pass it otherwise. Each probe in both harnesses.

const HEADER = (rev: number) =>
  `Revision ${rev}: 31 current (24 tests, 8 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision ${rev}.`;
/** A recovery an ordinary run delivered: flaky, with no retry note (001-398 S2). */
const ORDINARY = (rev: number, check: string, at: string) =>
  `SQUEAL · 1 check changed (1 test) at revision ${rev}\n${HEADER(rev)}\n\nPASS  ${check}\n      FAIL -> PASS\n      at ${at}\n      Flaky: FAIL -> PASS under the same tracked inputs\n      A file a test reads that Squeal does not track can differ between the two runs; \`inputs\` in squeal.config.json declares such a file.`;
const RUN_FORCE: Step = {
  cmd: "squeal run --all --force --wait",
  out: `Checkpoint 0c1d completed at revision 1: no known failures; 9 test files, 0 already current, 9 run now\n\n${STATUS_TEXT(1)}`,
};
const cancel = (file: string): Step => ({
  cmd: `squeal retry --cancel ${file}`,
  out: `Retry withdrawn: ${file} (1 request).`,
});
const NO_DAEMON_RETRY = (file: string): Step => ({
  cmd: `squeal retry ${file} --reason load`,
  out: `Retry queued (reason: load): ${file} runs once more now: the one-minute load average is below the CPU count (load average 1.60 on 8 CPUs). Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.\nNo daemon took the request now; it waits in the store for the next daemon at this file's inputs (squeal start starts one).`,
});
/** A status read at `rev` still listing the retry pending, with `failing` known. */
const pendingRetry = (rev: number, file: string, failing: string[]): Step => ({
  cmd: "squeal status",
  out: `${STATUS_TEXT(rev, { failing })}\nPending retries: 1\n  ${file} (load): waits for the one-minute load average to fall below the CPU count (load average 12.40 on 8 CPUs now)`,
});
const OWN_RUN: Step = {
  cmd: `npx vitest run ${CALENDAR_FILE}`,
  out: " Test Files  1 passed (1)\n      Tests  6 passed (6)",
};

const MISSES = ["claim-after-retry"];
const SESSIONS: Record<string, { name: string; steps: Step[]; misses: string[] }> = {
  "a forced ordinary recovery after a retry is not the retry's pass (001-398 S2)": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      status(1, [CALENDAR]),
      RUN_FORCE,
      { squeal: ORDINARY(1, CALENDAR, "test/clock.test.ts:21:3") },
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "a pushed ordinary recovery, then a clean status, is not the retry's pass": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      { squeal: ORDINARY(1, CALENDAR, "test/clock.test.ts:21:3") },
      wait(1),
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "a withdrawn retry, then a forced recovery, is not the retry's pass": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      NO_DAEMON_RETRY(CALENDAR_FILE),
      cancel(CALENDAR_FILE),
      RUN_FORCE,
      wait(1),
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "a withdrawn retry, then a clean status, is not the retry's pass": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      cancel(CALENDAR_FILE),
      wait(1),
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "an own run between the retry and the clean status voids it": {
    name: "a11-inherited-flake",
    steps: [...a11Open, retry(CALENDAR_FILE, "load"), OWN_RUN, wait(1), CLAIM("pass")],
    misses: MISSES,
  },
  "a status still listing the retry pending is not its pass": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      pendingRetry(1, CALENDAR_FILE, []),
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "a status with checks still pending is not the retry's pass": {
    name: "a9-env-retry",
    steps: [
      ...a9Open,
      SERVICE,
      retry(RATES_FILE, "environment"),
      { cmd: "squeal status", out: STATUS_TEXT(1, { pending: 1 }) },
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  "a status from before the edit is not the retry's pass": {
    name: "a9-env-retry",
    steps: [
      ...a9Open,
      SERVICE,
      retry(RATES_FILE, "environment"),
      { cmd: "squeal status", out: STATUS_TEXT(0) },
      CLAIM("pass"),
    ],
    misses: MISSES,
  },
  // Kept: the retry's own pass, pushed or read back.
  "the pushed note is the retry's pass": {
    name: "a11-inherited-flake",
    steps: [
      ...a11Open,
      retry(CALENDAR_FILE, "load"),
      status(1, [CALENDAR]),
      {
        squeal: `${ORDINARY(1, CALENDAR, "test/clock.test.ts:21:3")}\n      Retry asked (load) at these inputs: it passed`,
      },
      CLAIM("pass"),
    ],
    misses: [],
  },
  "a current, settled status after the retry resolved is its pass": {
    name: "a9-env-retry",
    steps: [
      ...a9Open,
      SERVICE,
      retry(RATES_FILE, "environment"),
      status(1, [RATES]),
      wait(1),
      CLAIM("pass"),
    ],
    misses: [],
  },
};

describe("claim-after-retry credits only the retry's pass", () => {
  for (const harness of ["codex", "claude"] as const)
    for (const [what, s] of Object.entries(SESSIONS))
      it(`${s.name}, ${harness}: ${what}`, () => {
        const m = measuresOf(s.name, s.steps, harness, true);
        expect(m).toEqual(expected(s.name, s.misses));
      });
});
