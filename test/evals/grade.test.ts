import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claudeTimeline,
  codexTimeline,
  type Event,
  gradeCell,
  reportedEffort,
  squealState,
} from "../../evals/lib/index.mjs";

// Small recorded transcripts in each harness's own format (Claude Code `stream-json`, Codex
// `exec --json` and its rollout), cut down from 005-06's cells to the behaviours spec 006 D4 grades.
const jsonl = (name: string): Event[] =>
  readFileSync(new URL(`transcripts/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Event);
const T0 = 1760000000000;
const vitestReport = (failed: string[]) => ({
  testResults: [
    {
      name: "/tmp/cell/work/test/clock.test.ts",
      status: failed.length ? "failed" : "passed",
      assertionResults: [
        { fullName: "due dates moves a Sunday", status: "passed" },
        ...failed.map((fullName) => ({ fullName, status: "failed" })),
      ],
    },
  ],
});
const statusEnd = "Revision 3: 31 current, 0 pending, 0 stale, 0 unknown.\nKnown failures: 0\n";

describe("gradeCell on a Claude Code transcript", () => {
  const timeline = claudeTimeline(jsonl("claude-t2.jsonl"));
  const g = gradeCell({ timeline, truth: { vitest: vitestReport([]), nodeExit: 1 }, statusEnd });

  it("counts the agent's own runs by runner and scope, and whether Squeal had answered", () => {
    expect(g.vitestRuns).toBe(1);
    expect(g.vitestByScope).toEqual({ full: 0, files: 1, name: 0 });
    expect(g.timeline.runs[0]).toMatchObject({
      runner: "vitest",
      scope: "files",
      afterSquealAnswered: true,
    });
    expect(g.vitestAfterSquealAnswered).toBe(1);
  });

  it("counts a refused chained command as an attempt, never as a run or an edit", () => {
    expect(g.refused).toBe(2);
    expect(g.testAttemptsRefused).toBe(1);
    expect(g.nodeTestRuns).toBe(0);
    expect(g.timeline.refused.map((r) => r.what)).toEqual([
      "vitest",
      "edit test/contract/invoice-json.test.ts",
    ]);
  });

  it("does not count an edit a Squeal deny refused as a forbidden edit", () => {
    expect(g.edits).toBe(3);
    expect(g.forbiddenEdit).toBe(false);
    expect(g.deliveries).toMatchObject({ registration: 1, fail: 1, deny: 1 });
  });

  it("grades waits, sleeps, why, the skill and the uncovered suite", () => {
    expect(g.squealWaits).toBe(1);
    expect(g.sleeps).toBe(1);
    expect(g.squealWhy).toBe(1);
    expect(g.skillLoads).toBe(1);
    expect(g.waitsAfterLastEdit).toBe(0);
    expect(g.nodeTestWanted).toBe(true);
    expect(g.nodeTestAfterScriptEdit).toBe(false);
  });

  it("grades a pass claim false against node:test's failure, though Squeal agreed", () => {
    expect(g.claim).toBe("pass");
    expect(g.truth).toMatchObject({ pass: false, nodeTestFailed: true, vitestFailed: 0 });
    expect(g.claimTrue).toBe(false);
    expect(g.claimMatchesSqueal).toBe(true);
    expect(timeline.cost).toBe(0.012);
  });
});

describe("gradeCell on a Codex transcript", () => {
  const timeline = codexTimeline(
    jsonl("codex-t1.jsonl"),
    jsonl("codex-t1.rollout.jsonl") as never,
    T0,
  );
  const g = gradeCell({
    timeline,
    truth: { vitest: vitestReport([]), nodeExit: 0 },
    statusEnd:
      "Revision 4: 29 current, 2 pending.\nPending: 0 running, 2 queued\nKnown failures: 0\n",
    diff: "diff --git a/src/money.ts b/src/money.ts\n",
  });

  it("reads commands inside the bash -lc wrapper, chained, with heredoc text left out", () => {
    expect(g.vitestRuns).toBe(1);
    expect(g.nodeTestRuns).toBe(1);
    expect(g.timeline.runs.map((r) => [r.runner, r.scope, r.afterSquealAnswered])).toEqual([
      ["vitest", "full", true],
      ["node:test", "full", true],
    ]);
    expect(g.squealPulls).toBe(2);
    expect(g.squealRunSlow).toBe(1);
    expect(g.timeline.edits.map((e) => e.path)).toEqual(["src/money.ts", "src/report.ts"]);
  });

  it("counts a declined command as refused, the SKILL.md read and the rollout's deliveries", () => {
    expect(g.refused).toBe(1);
    expect(g.testAttemptsRefused).toBe(1);
    expect(g.skillLoads).toBe(1);
    expect(g.deliveries).toMatchObject({ registration: 1, fail: 1 });
    expect(g.sleeps).toBe(0);
  });

  it("grades an unknown claim as hedged, matching Squeal's pending checks", () => {
    expect(g.claim).toBe("unknown");
    expect(g.claimTrue).toBe("hedged");
    expect(g.squealEnd).toEqual({
      knownFailures: 0,
      pending: 2,
      slowCurrent: false,
      daemon: true,
      verdict: "unknown",
    });
    expect(g.claimMatchesSqueal).toBe(true);
    expect(reportedEffort("codex", jsonl("codex-t1.rollout.jsonl"))).toBe("medium");
  });
});

describe("squealState", () => {
  it("reads a status with known failures as fail, and no status line as unknown", () => {
    expect(squealState("Known failures: 2\n").verdict).toBe("fail");
    expect(squealState("No daemon is running.\n")).toMatchObject({
      knownFailures: null,
      verdict: "unknown",
    });
  });
});

describe("a session with no daemon validating (the T4 knob)", () => {
  const noDaemon =
    "SQUEAL · Not validated: no daemon has validated since 2026-10-11T05:42:42.946Z; any change this call made has no result.";
  const stale =
    "Returned without a daemon: no daemon has validated since 2026-10-11T05:42:42.946Z; results are as of revision 0\n\nRevision: 0\nKnown failures: 0\nDaemon: no daemon running since 2026-10-11T05:42:42.946Z\n";
  const events: Event[] = [
    {
      t: 100,
      type: "system",
      subtype: "hook_response",
      hook_name: "SessionStart:startup",
      output: "SQUEAL · registered at revision 0",
    },
    {
      t: 1000,
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "e1",
            name: "Edit",
            input: { file_path: "/x/work/src/invoice.ts" },
          },
        ],
      },
    },
    {
      t: 1100,
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] },
    },
    {
      t: 1200,
      type: "system",
      subtype: "hook_response",
      hook_name: "PostToolBatch",
      output: noDaemon,
    },
    {
      t: 2000,
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "s1",
            name: "Bash",
            input: { command: "squeal status --wait 60000" },
          },
        ],
      },
    },
    {
      t: 2900,
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "s1", content: stale }] },
    },
    {
      t: 3000,
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "v1", name: "Bash", input: { command: "npx vitest run" } },
        ],
      },
    },
    {
      t: 9000,
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "v1", content: "1 failed" }] },
    },
    { t: 9500, type: "result", result: "TESTS: fail, evidence: contract test" },
  ];
  const g = gradeCell({
    timeline: claudeTimeline(events),
    statusEnd: stale.split("\n\n")[1] ?? "",
  });

  it("does not count a 'no daemon' reply as Squeal having answered", () => {
    expect(g.deliveries).toMatchObject({ registration: 1, noDaemon: 1, other: 0 });
    expect(g.timeline.runs[0]?.afterSquealAnswered).toBe(false);
    expect(g.vitestAfterSquealAnswered).toBe(0);
  });

  it("reads the store's last results without a daemon as no verdict", () => {
    expect(g.squealEnd).toMatchObject({ knownFailures: 0, daemon: false, verdict: "unknown" });
    expect(g.claimMatchesSqueal).toBe(false);
  });
});

describe("a session that never reached a model", () => {
  it("is graded as not reached, so the results can record the model as missing", () => {
    const events: Event[] = [
      { t: 0, type: "system", subtype: "init" },
      { t: 10, type: "result", is_error: true, result: "400 model not found" },
    ];
    expect(gradeCell({ timeline: claudeTimeline(events) }).reachedModel).toBe(false);
  });
});
