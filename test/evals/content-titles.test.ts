import { describe, expect, it } from "vitest";
import { claudeTimeline, type Event, gradeCell } from "../../evals/lib/index.mjs";
import { formatDelta } from "../../src/core/delivery/format.js";
import type { Delta } from "../../src/core/types/delivery.js";
import { settled } from "./status-snapshot.js";

/*
 * Row 005-91 (c): a delivery with no changed check is titled by its other lines, no longer
 * `SQUEAL · revision N`. The grader counts deliveries by kind from the title; each title from the
 * real formatter, and the old one, still reads as a result, never as `other`.
 */

const consumer = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const delta = (parts: Partial<Delta>): string =>
  formatDelta({
    schemaVersion: 1,
    consumer,
    header: { ...settled, revision: 4 },
    label: "transitions",
    entries: [],
    ...parts,
  });

const NEW = [
  delta({ sawEdit: { queued: 2 } }),
  delta({ sawEdit: { queued: 2 }, countsOwed: { lookupOnly: false } }),
  // Review 0.1.527, B2: code lines that count no function change.
  delta({
    code: {
      v: 1,
      entries: [],
      more: 0,
      recount: { revision: 4, at: 1, reason: "threshold", threshold: 30, over: 0 },
    },
  }),
  delta({
    code: {
      v: 1,
      entries: [],
      more: 0,
      crapRecount: { revision: 4, at: 1, threshold: 30, over: 1 },
    },
  }),
];
const OLD = [
  "SQUEAL · revision 4\nRevision 4: no check pending, stale or unknown.",
  // 0.1.527's settled line (001-223), which row 005-93 removed.
  "SQUEAL · your edits' test files are current at revision 4\nRevision 4: no check pending, stale or unknown.\nAll 2 test files your edits since revision 2 re-keyed are current.",
];

const hook = (t: number, output: string): Event => ({
  t,
  type: "system",
  subtype: "hook_response",
  hook_name: "PostToolBatch",
  output,
});

describe("content titles in the grader's delivery count (row 005-91 c)", () => {
  it("are titled by their content, not the revision alone", () => {
    for (const text of NEW) expect(text.split("\n")[0]).not.toBe("SQUEAL · revision 4");
  });

  it("count as results, as the old title did, never as other", () => {
    const events = [...NEW, ...OLD].map((text, i) => hook(100 * (i + 1), text));
    const g = gradeCell({ timeline: claudeTimeline(events), statusEnd: settled });
    expect(g.deliveries).toMatchObject({ registration: 0, fail: 0, other: 0 });
  });
});
