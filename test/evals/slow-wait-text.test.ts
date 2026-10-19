import { describe, expect, it } from "vitest";
import { SLOW_CHECKS, squealEvidence } from "../../evals/lib/index.mjs";
import { type EndedWait, waitText } from "../../src/cli/status-wait-lines.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

/*
 * Row 004-83 (spec 004 D8 as amended 2026-10-19): every slow-file text names
 * `squeal run --slow --wait 60000` as the wait for the slow files' results,
 * and the `Affected checks` headline names the slow files among its running
 * and queued checks. The evals parser reads the same revision, counts and
 * slow-tier state from the new text as from 0.1.215 to 0.1.221's, round-
 * tripped through the real formatters under both policies and triggers, as
 * text and in a Claude Code hook's JSON.
 */

const SLOW = "test/slow/ledger.test.ts";
const WAIT = "`squeal run --slow --wait 60000` waits for their results";

/** Revision 5: one slow file pending (its checks queued), one not run, `fast` fast checks queued. */
function open(requireSlowSuite: boolean, pausesOnly: boolean, fast = 1): StatusSnapshot {
  const queued = SLOW_CHECKS + fast;
  return {
    ...settled,
    revision: 5,
    refinedRevision: 5,
    dirtyObservedAt: 5,
    counts: { current: 31 - queued, pending: queued, stale: 0, unknown: 0 },
    breakdown: { ...settled.breakdown, pendingByPhase: { queued, running: 0 } },
    slowPending: {
      testFiles: 1,
      checks: SLOW_CHECKS,
      testFilesWithoutChecks: 0,
      files: [{ project: "", path: SLOW }],
    },
    slowTier: {
      testFiles: 2,
      current: 0,
      pending: 1,
      notRun: 1,
      currentAt: null,
      activity: { kind: "waiting", for: pausesOnly ? "idle" : "fast" },
      ...(pausesOnly ? { pausesOnly } : {}),
      ...(requireSlowSuite ? { stopWaitMs: 120_000 } : {}),
    },
  } as StatusSnapshot;
}

const FORMS = [
  ["status", (s: StatusSnapshot) => formatStatus(s, 2_000 as never), "pull"],
  [
    "a quiet status --wait",
    (s: StatusSnapshot) =>
      waitText(
        { outcome: "quiet", transitions: 0, waitedMs: 500, result: s } as EndedWait,
        2_000 as never,
      ),
    "pull",
  ],
  [
    "registration",
    (s: StatusSnapshot) => formatRegistration({ header: s, knownFailures: [] } as never),
    "push",
  ],
  [
    "news header",
    (s: StatusSnapshot) => formatDelta({ header: s, entries: [], slowTierChanged: true } as never),
    "push",
  ],
] as const;

const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe("the parser reads 0.1.222's slow-file texts from the real formatters (row 004-83)", () => {
  for (const requireSlowSuite of [false, true])
    for (const pausesOnly of [false, true])
      for (const [form, format, from] of FORMS)
        for (const [wrapped, wrap] of [
          ["as text", (x: string) => x],
          ["in a hook's JSON", hook],
        ] as const)
          it(`${form}, policy ${requireSlowSuite ? "on" : "off"}, ${pausesOnly ? "idle" : "continuous"}, ${wrapped}`, () => {
            const text = format(open(requireSlowSuite, pausesOnly));
            // The new text is what is read: the Slow tier line ends with the wait.
            expect(text).toContain(`; ${WAIT}.`);
            if (form !== "registration" && form !== "news header") {
              expect(text).toContain(`; among them 1 slow test file, ${SLOW}: `);
            }
            if (form === "a quiet status --wait") {
              expect(text).toContain(
                requireSlowSuite
                  ? "which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them"
                  : `this repository does not require them before you finish; ${WAIT}`,
              );
            }
            const step = squealEvidence(wrap(text), from);
            expect(step).toMatchObject({ revision: 5, slow: false, slowNotCurrent: 2 });
            expect(step?.pending).toBe(SLOW_CHECKS + 1);
          });
});

describe("the parser still reads 0.1.215 to 0.1.221's slow-file texts", () => {
  const status = (ending: string) =>
    [
      "Revision: 5 · abc1234 + 0",
      "Known failures: 0",
      "Affected checks: 28 passed (28 tests), 0 running, 3 queued (3 tests)",
      "Full-suite checkpoint: none completed at any revision (the counts are for revision 5; `squeal run --all` requests one)",
      `Slow tier: 2 test files; 1 pending, waiting for fast test files; 1 not run at revision 5. ${ending}`,
    ].join("\n");
  it.each([
    "Squeal runs the pending ones after the fast tests and has not queued the rest; `squeal run --slow` runs them now.",
    "Squeal runs the pending ones when the agent pauses and has not queued the rest; `squeal run --slow` runs them now.",
    "Stop waits up to 2 min for them or holds the agent once; `squeal run --slow` runs them now.",
  ])("a status ending %s", (ending) => {
    const text = status(ending);
    expect(squealEvidence(text, "pull")).toMatchObject({
      revision: 5,
      slow: false,
      slowNotCurrent: 2,
      pending: 3,
    });
    // 0.1.220 and 0.1.221's quiet line, policy off.
    const quiet = `${text}\n\nReturned on quiet: nothing pending at revision 5 after 0.5 s; 2 slow files are not current; this repository does not require them before you finish (\`squeal run --slow\` runs them). Worktree: /tmp/cell/work`;
    expect(squealEvidence(hook(quiet), "pull")).toMatchObject({
      revision: 5,
      slowNotCurrent: 2,
      pending: 3,
    });
  });
});
