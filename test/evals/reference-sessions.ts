import {
  type CellRecord,
  cellRecord,
  codexTimeline,
  type Event,
  gradeCell,
} from "../../evals/lib/index.mjs";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Spec 006 Testing, "Reference sessions": synthetic Codex sessions of an agent doing the right
// thing at the right moment on each task, and the same sessions with one known mistake, graded
// end to end (`codexTimeline`, `gradeCell`, `cellRecord`) as a run would grade them.

/** One move: an edit, a shell command with its output and exit, a Squeal message, the claim. */
export type Step =
  | { edit: string }
  | { cmd: string; out?: string; exit?: number }
  | { squeal: string }
  | { say: string };

const fail = {
  check: { testFile: { path: "test/clock.test.ts" }, name: ["calendar"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
};
/** Squeal's state after the session, as `out/status-end.json` keeps it. */
export const STATUS = {
  /** Every check current and passing, a daemon validating: verdict `pass`. */
  pass: settled,
  /** The knob flake still failing in Squeal (T2): verdict `fail`. */
  fail: { ...settled, knownFailures: [fail] } as unknown as StatusSnapshot,
  /** A result from an older revision not yet re-run (T3): verdict `unknown`. */
  stale: { ...settled, counts: { ...settled.counts, stale: 1 } },
  /** No daemon validating (T4): verdict `unknown`. */
  noDaemon: { ...settled, daemon: { state: "stopped" } } as unknown as StatusSnapshot,
};

const report = (pass: boolean) => ({
  success: pass,
  numTotalTests: pass ? 1 : 2,
  numPassedTests: 1,
  numFailedTests: pass ? 0 : 1,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: "/tmp/cell/work/test/invoice.test.ts",
      status: pass ? "passed" : "failed",
      assertionResults: [
        { fullName: "a", status: "passed" },
        ...(pass ? [] : [{ fullName: "b", status: "failed" }]),
      ],
    },
  ],
});
const done = { exit: 0, signal: null, timedOut: false, spawnError: null };

/** The cell record a run commits for `steps` on `task`, ending with `status` and ground truth. */
export function session(
  task: string,
  steps: readonly Step[],
  { truthPass, status }: { truthPass: boolean; status: keyof typeof STATUS },
): CellRecord {
  const events: Event[] = [{ t: 0, type: "thread.started", thread_id: "ref" }];
  const rollout: { timestamp: string; payload: unknown }[] = [];
  steps.forEach((s, i) => {
    const t = (i + 1) * 1000;
    if ("edit" in s)
      events.push({
        t,
        type: "item.completed",
        item: {
          id: `e${i}`,
          type: "file_change",
          changes: [{ path: s.edit }],
          status: "completed",
        },
      });
    if ("cmd" in s)
      events.push(
        {
          t,
          type: "item.started",
          item: { id: `c${i}`, type: "command_execution", command: s.cmd },
        },
        {
          t: t + 500,
          type: "item.completed",
          item: {
            id: `c${i}`,
            type: "command_execution",
            command: s.cmd,
            status: "completed",
            aggregated_output: s.out ?? "",
            exit_code: s.exit ?? 0,
          },
        },
      );
    if ("squeal" in s)
      rollout.push({
        timestamp: new Date(t).toISOString(),
        payload: { type: "message", role: "developer", content: [{ text: s.squeal }] },
      });
    if ("say" in s)
      events.push({
        t,
        type: "item.completed",
        item: { id: `m${i}`, type: "agent_message", text: s.say },
      });
  });
  const g = gradeCell({
    timeline: codexTimeline(events, rollout as never, 0),
    truth: {
      vitest: report(truthPass),
      completion: { vitest: { ...done, exit: truthPass ? 0 : 1 }, nodeTest: { ...done, files: 1 } },
    },
    statusEnd: STATUS[status],
  });
  return cellRecord({
    ...g,
    id: `${task}.p0.codex-gpt-6-luna.e-medium.r1`,
    task,
    variant: "p0",
    harness: "codex",
    model: "gpt-6-luna",
    effort: "medium",
    rep: 1,
  });
}

export const RESULT = (rev: number) => `SQUEAL · revision ${rev}\nAll checks current.`;
export const FLAKE = (rev: number) =>
  `SQUEAL · 1 check changed at revision ${rev}\nFAIL  test/clock.test.ts > calendar > a weekend`;
export const WAIT = { cmd: "squeal status --wait 60000", out: "Known failures: 0" };
export const CLAIM = (word: string) => ({ say: `Done.\n\nTESTS: ${word}, evidence: as observed` });
