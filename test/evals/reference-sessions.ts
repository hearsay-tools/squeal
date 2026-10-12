import {
  type CellRecord,
  cellRecord,
  claudeTimeline,
  codexTimeline,
  type Event,
  gradeCell,
} from "../../evals/lib/index.mjs";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Spec 006 Testing, "Reference sessions": synthetic Codex or Claude Code sessions of an agent
// doing the right thing at the right moment on each task, and the same sessions with one known
// mistake, graded end to end (`codexTimeline` or `claudeTimeline`, `gradeCell`, `cellRecord`) as
// a run would grade them. Squeal's texts are worded as the product words them.

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
  noDaemon: {
    ...settled,
    daemon: { state: "stopped" },
  } as unknown as StatusSnapshot,
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

export type Harness = "codex" | "claude";

/** The cell record a run commits for `steps` on `task`, ending with `status` and ground truth. */
export function session(
  task: string,
  steps: readonly Step[],
  {
    truthPass,
    status,
    harness = "codex",
  }: {
    truthPass: boolean;
    status: keyof typeof STATUS;
    harness?: Harness | undefined;
  },
): CellRecord {
  const g = gradeCell({
    timeline: harness === "codex" ? codexSession(steps) : claudeSession(steps),
    truth: {
      vitest: report(truthPass),
      completion: {
        vitest: { ...done, exit: truthPass ? 0 : 1 },
        nodeTest: { ...done, files: 1 },
      },
    },
    statusEnd: STATUS[status],
  });
  const model = harness === "codex" ? "gpt-6-luna" : "haiku";
  return cellRecord({
    ...g,
    id: `${task}.p0.${harness}-${model}.e-medium.r1`,
    task,
    variant: "p0",
    harness,
    model,
    effort: "medium",
    rep: 1,
  });
}

function codexSession(steps: readonly Step[]) {
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
        payload: {
          type: "message",
          role: "developer",
          content: [{ text: s.squeal }],
        },
      });
    if ("say" in s)
      events.push({
        t,
        type: "item.completed",
        item: { id: `m${i}`, type: "agent_message", text: s.say },
      });
  });
  return codexTimeline(events, rollout as never, 0);
}

/** The same moves as Claude Code's `stream-json`: Squeal's texts arrive as hook output. */
function claudeSession(steps: readonly Step[]) {
  const events: Event[] = [];
  let final = "";
  steps.forEach((s, i) => {
    const t = (i + 1) * 1000;
    const tool = (name: string, input: object, out: string, error: boolean) =>
      events.push(
        {
          t,
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id: `u${i}`, name, input }],
          },
        },
        {
          t: t + 500,
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: `u${i}`,
                content: out,
                is_error: error,
              },
            ],
          },
        },
      );
    if ("edit" in s) tool("Edit", { file_path: `/tmp/cell/work/${s.edit}` }, "ok", false);
    if ("cmd" in s) {
      const exit = s.exit ?? 0;
      const out = exit === 0 ? (s.out ?? "") : `Exit code ${exit}\n${s.out ?? ""}`;
      tool("Bash", { command: s.cmd }, out, exit !== 0);
    }
    if ("squeal" in s)
      events.push({
        t,
        type: "system",
        subtype: "hook_response",
        hook_name: "PostToolUse",
        output: s.squeal,
      });
    if ("say" in s) {
      final = s.say;
      events.push({
        t,
        type: "assistant",
        message: { content: [{ type: "text", text: s.say }] },
      });
    }
  });
  events.push({ t: (steps.length + 1) * 1000, type: "result", result: final });
  return claudeTimeline(events);
}

const COUNTS = (rev: number, pending: number, stale = 0, unknown = 0) =>
  `Revision ${rev}: ${31 - pending - stale - unknown} current, ${pending} pending, ${stale} stale, ${unknown} unknown. Full-suite checkpoint: none completed at any revision.`;
/** A delivered header: Squeal at `rev`, every check current. */
export const RESULT = (rev: number) => `SQUEAL · revision ${rev}\n${COUNTS(rev, 0)}`;
/** A delivered header: Squeal at `rev` with `n` checks still pending. */
export const PENDING = (rev: number, n = 3) =>
  `SQUEAL · revision ${rev}\n${COUNTS(rev, n)}\nSqueal saw your edit and queued ${n} test files; results arrive with later tool calls, and passing ones stay silent.`;
/** A delivery naming a failing check of `file` at `rev`, everything else current. */
export const FAILED = (rev: number, check: string) =>
  `SQUEAL · 1 check changed at revision ${rev}\n${COUNTS(rev, 0)}\n\nFAIL  ${check}\n    Seen by Squeal's run at revision ${rev}.\n    AssertionError: expected false to be true`;
/**
 * A delivery at `rev` with `pending` checks still pending, naming `check` failed as Squeal's run
 * at `seen` saw it: at `rev`, or at an older revision with `rev` pending (`formatDelta`'s words).
 */
export const PENDING_FAILED = (rev: number, check: string, seen = rev, pending = 3) =>
  `SQUEAL · 1 check changed at revision ${rev}\n${COUNTS(rev, pending)}\n\nFAIL  ${check}\n      PASS -> FAIL, seen by Squeal's run at revision ${seen}${seen < rev ? `, revision ${rev} pending` : ""}\n\nFull output: squeal why "${check}"`;
/** T2's knob flake failing in Squeal at `rev`. */
export const FLAKE = (rev: number) =>
  FAILED(rev, "test/clock.test.ts > due dates > loads the holiday calendar within its budget");
/** The Sunday regression test failing before the fix (review 006-13 S1). */
export const SUNDAY = (rev: number) =>
  FAILED(rev, "test/clock.test.ts > due dates > moves a Sunday due date to Monday");
/** A delivery of the Sunday test recovering while the flake keeps failing. */
export const RECOVERED = (rev: number) =>
  `SQUEAL · 2 checks changed at revision ${rev}\n${COUNTS(rev, 0)}\n\nFAIL  test/clock.test.ts > due dates > loads the holiday calendar within its budget\n    Seen by Squeal's run at revision ${rev}.\n\nPASS  test/clock.test.ts > due dates > moves a Sunday due date to Monday\n    FAIL -> PASS`;
/** `squeal status` text: `rev`, `failing` known failures listed as current, and what is left. */
export const STATUS_TEXT = (
  rev: number,
  { failing = [] as string[], pending = 0, stale = 0, unknown = 0, seen = rev } = {},
) =>
  [
    `Revision: ${rev}`,
    `Known failures: ${failing.length}`,
    ...failing.flatMap((f) => [
      `  FAIL  ${f}`,
      `        observed at revision ${seen}, ${seen < rev ? "pending" : "current"}`,
    ]),
    `Affected checks: ${31 - pending - stale - unknown} passed, 0 running, ${pending} queued${stale ? `, ${stale} stale` : ""}${unknown ? `, ${unknown} unknown` : ""}`,
    "Full-suite checkpoint: none completed at any revision",
    "",
    "Daemon: alive",
  ].join("\n");
/** `squeal status --wait` that returned with Squeal current at `rev`. */
export const waitAt = (rev: number, failing: string[] = []) => ({
  cmd: "squeal status --wait 60000",
  out: `Returned on quiet: nothing pending at revision ${rev} after 4.0 s\n\n${STATUS_TEXT(rev, { failing })}`,
});
/** `squeal status --wait` that returned on its timeout at `rev`, `pending` checks left, `failing` listed. */
export const waitFailing = (rev: number, failing: string[], { pending = 2, seen = rev } = {}) => ({
  cmd: "squeal status --wait 60000",
  out: `Returned on timeout after 60.0 s: ${pending} pending at revision ${rev}\n\n${STATUS_TEXT(rev, { failing, pending, seen })}`,
});
/** A wait current at revision 1, for a session that saw no revision before its edit. */
export const WAIT = waitAt(1);
/** `squeal status --wait` that returned on its timeout with `n` checks pending at `rev`. */
export const waitTimeout = (rev: number, n = 1) => ({
  cmd: "squeal status --wait 1",
  out: `Returned on timeout after 1.0 s: ${n} pending at revision ${rev}\n\n${STATUS_TEXT(rev, { pending: n })}`,
});
export const CLAIM = (word: string) => ({
  say: `Done.\n\nTESTS: ${word}, evidence: as observed`,
});
/** The registration at session start: `rev`, with `stale` checks from an older revision. */
export const REGISTERED = (rev: number, stale = 0) =>
  `SQUEAL · registered at revision ${rev}\n${COUNTS(rev, 0, stale)}\nKnown failures: 0`;
/** The registration with no daemon validating (T4's knob). */
export const REGISTERED_NO_DAEMON = (rev: number) =>
  `SQUEAL · registered at revision ${rev}\n${COUNTS(rev, 0)} No daemon is running; results are as of revision ${rev}.\nKnown failures: 0`;
