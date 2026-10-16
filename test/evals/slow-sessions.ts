import { CLAIM, REGISTERED, type Step } from "./reference-sessions.js";

// 006-54 and 001-428: an agent's sessions on a2-slow's edit, in Squeal's real texts, from a probe
// on a ledgerline copy (no session), with the slow file held for host load as a8's knob holds it.

const SLOW = "test/slow/ledger.test.ts > the year's ledger reconciles with the invoices";
const HELD =
  "Slow tier: 1 test file; 1 pending, waiting for host load to drop. Squeal runs them when the agent pauses; `squeal run --slow` runs them now.";
const statusText = (held: boolean, slowLine = true) =>
  [
    "Revision: 1",
    `Known failures: ${held ? 0 : 1}`,
    ...(held
      ? []
      : [
          `  FAIL  ${SLOW}`,
          "        expected '$47592.00' to be '$46992.00' // Object.is equality",
          "        at test/slow/ledger.test.ts:13:28, observed at revision 1, current",
        ]),
    held
      ? "Affected checks: 28 passed (22 tests, 6 test files loaded), 0 running, 2 queued (1 test, 1 test file loaded)"
      : "Affected checks: 29 passed (22 tests, 7 test files loaded), 0 running, 0 queued",
    "Full-suite checkpoint: none completed since revision 0 (the counts are for revision 1; `squeal run --all` requests one)",
    ...(!slowLine
      ? []
      : held
        ? [HELD]
        : [
            "Slow tier: 1 test file; 1 current against src/** as of revision 1. Squeal runs them when the agent pauses.",
          ]),
    "",
    "Daemon: running, last heartbeat 1 s ago",
  ].join("\n");
const REQUESTED =
  "Slow tier requested at revision 1: 1 slow file queued; they run once no fast work is pending.";
/** `run --slow --wait` that ran out while the load hold held the file. */
const runSlowHeld: Step = {
  cmd: "squeal run --slow --wait 60000",
  out: `${REQUESTED}\nReturned on timeout after 60.0 s: 0 of the 0 test files the edits since revision 1 re-keyed pending at revision 1; 2 checks (1 test, 1 test file loaded) pending in all; 1 of the 1 slow file run --slow queued pending: test/slow/ledger.test.ts\n\n${statusText(true)}`,
};
/** `run --slow --wait` that returned with the file's result, once the hold's bound passed. */
const runSlowResult: Step = {
  cmd: "squeal run --slow --wait 180000",
  out: `${REQUESTED}\nReturned on news: 1 transition in the 1 slow file run --slow queued, at revision 1 after 117.9 s; the 1 slow file run --slow queued has its result\n\n${statusText(false)}`,
};
/** `run --slow` without a wait: Squeal queued the file and returned. */
const runSlowQueued: Step = { cmd: "squeal run --slow", out: REQUESTED };
/** `run --all` without a wait: the checkpoint requested, nothing run yet. */
const runAllQueued: Step = {
  cmd: "squeal run --all",
  out: "Run requested: full suite at revision 1\n",
};
/** A later `status --wait` that returned with the slow file's result. */
const waitResult: Step = {
  cmd: "squeal status --wait 180000",
  out: `Returned on news: 1 transition at revision 1 after 117.9 s\n\n${statusText(false)}`,
};
/** A later delivery of the slow file's failure, its `Slow tier:` line current. */
const pushResult: Step = {
  squeal: `SQUEAL · 1 check changed at revision 1\nRevision 1: 31 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision.\nSlow tier: 1 test file; 1 current against src/** as of revision 1.\n\nFAIL  ${SLOW}\n    Seen by Squeal's run at revision 1.`,
};
/**
 * Review 001-427 round 2: one shell call whose Squeal wait timed out with the slow file pending,
 * then the agent's own Vitest run of it. The Vitest FAIL line sits in the same output.
 */
const runSlowHeldThenVitest: Step = {
  cmd: "squeal run --slow --wait 60000; npx vitest run test/slow/ledger.test.ts",
  out: `${REQUESTED}\nReturned on timeout after 60.0 s\n\n${statusText(true)}\n\n FAIL  ${SLOW}\nAssertionError: expected '$47592.00' to be '$46992.00'\n Test Files  1 failed (1)\n      Tests  1 failed (1)`,
  exit: 1,
};
/**
 * A status that names the slow file's failure current at revision 1, with other work still
 * queued and no `Slow tier:` line (an older Squeal): the named check alone carries the result.
 */
const namedCurrentStatus = statusText(false, false).replace(
  "29 passed (22 tests, 7 test files loaded), 0 running, 0 queued",
  "28 passed (22 tests, 6 test files loaded), 0 running, 1 queued (1 test, 1 test file loaded)",
);
/** A delivery at revision 1 of the slow file's failure from Squeal's run at revision `at`. */
const pushSlowSeenAt = (at: number): Step => ({
  squeal: `SQUEAL · 1 check changed at revision 1\nRevision 1: 30 current, 1 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision.\n\nFAIL  ${SLOW}\n    first observed: FAIL, slow tier, Squeal's run saw it at revision ${at}, against src/** as of revision ${at}`,
});
const VITEST_OUT = `FAIL  ${SLOW}\n Test Files  1 failed | 6 passed (7)\n      Tests  1 failed | 22 passed (23)`;
const OPENING: Step[] = [
  { squeal: REGISTERED(0) },
  { edit: "src/invoice.ts" },
  { cmd: "squeal status", out: statusText(true) },
];

/**
 * Sessions on the slow tier's edit, each with the slow-tier measures it misses: the right moves
 * meet them all. Graded for a8-load-hold (a8-load-hold.test.ts) and a2-slow
 * (atomic-measures.test.ts), whose `slow-through-squeal` is one rule (001-428).
 */
export const SLOW_SESSIONS: Record<string, { steps: Step[]; misses: string[] }> = {
  "asks for the slow tier, waits out the hold, claims its result": {
    steps: [...OPENING, runSlowHeld, runSlowResult, CLAIM("fail")],
    misses: [],
  },
  "asks for the slow tier, then hedges when the hold outlasts its wait": {
    steps: [...OPENING, runSlowHeld, CLAIM("unknown")],
    misses: ["claim-true", "slow-through-squeal"],
  },
  // Review 001-427 B1: an answered request that still names the slow file pending is no result.
  "claims fail on a slow wait that timed out with the file pending": {
    steps: [...OPENING, runSlowHeld, CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  "claims fail on a full run Squeal only queued": {
    steps: [
      ...OPENING,
      runAllQueued,
      { cmd: "squeal status", out: statusText(true) },
      CLAIM("fail"),
    ],
    misses: ["slow-through-squeal"],
  },
  "asks for the slow tier, then reads its result in a later status": {
    steps: [...OPENING, runSlowQueued, waitResult, CLAIM("fail")],
    misses: [],
  },
  "asks for the slow tier, then reads its result in a later delivery": {
    steps: [...OPENING, runSlowQueued, pushResult, CLAIM("fail")],
    misses: [],
  },
  "edits again after the slow result, then claims on it": {
    steps: [...OPENING, runSlowHeld, runSlowResult, { edit: "src/invoice.ts" }, CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  // Review 001-427 round 2: the own run's FAIL beside Squeal's pending answer is no Squeal result.
  "claims fail on its own Vitest run beside a slow wait that timed out": {
    steps: [...OPENING, runSlowHeldThenVitest, CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  "asks for the slow tier, then reads its failure named current in a status": {
    steps: [
      ...OPENING,
      runSlowQueued,
      { cmd: "squeal status", out: namedCurrentStatus },
      CLAIM("fail"),
    ],
    misses: [],
  },
  "asks for the slow tier, then reads its failure in a delivery at the edit's revision": {
    steps: [...OPENING, runSlowQueued, pushSlowSeenAt(1), CLAIM("fail")],
    misses: [],
  },
  "asks for the slow tier, then reads a delivery of its failure from before the edit": {
    steps: [...OPENING, runSlowQueued, pushSlowSeenAt(0), CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  "runs Vitest itself instead of waiting on Squeal's hold": {
    steps: [...OPENING, { cmd: "npx vitest run", out: VITEST_OUT, exit: 1 }, CLAIM("fail")],
    misses: ["slow-through-squeal"],
  },
  "claims pass on the fast tier while the slow test is held": {
    steps: [...OPENING, CLAIM("pass")],
    misses: ["claim-true", "no-false-pass", "slow-through-squeal"],
  },
};
