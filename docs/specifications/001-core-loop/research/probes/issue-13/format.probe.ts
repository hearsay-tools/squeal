import { describe, expect, it } from "vitest";
import { formatDelta } from "../../../../../../src/core/delivery/index.js";
import { withheldForTouch, withholdNote } from "../../../../../../src/core/scheduler/stability.js";
import { unknownFileText } from "../../../../../../src/core/status/unknown-files.js";
import type {
  Delta,
  RunReport,
  StatusHeader,
  TransitionEntry,
} from "../../../../../../src/core/types/index.js";
import { withoutTouched } from "../../../../../../src/runners/vitest/moved.js";

// Throwaway probe for research/issue-13.md. Not product code.
// Formatter reproduction: the product's own reason builders and renderers, fed
// a synthetic artifact list sized like the issue's 31,065-character failure.
// It replays no originating run; `scheduler.probe.ts` drives a real run.

const TEST = "packages/web/src/test/card-2-contrast.test.ts";
const EXPLANATION = "was written during this run and ended as it was";
const artifacts = (n: number) =>
  Array.from({ length: n }, (_, i) => `packages/cezar/dist/agent-config/module-${i}.d.ts`);

const empty: RunReport = {
  end: "completed",
  durationMs: 548_688,
  completedFiles: [{ project: "", path: TEST }],
  results: [],
  fileErrors: [],
  failure: null,
};

/** The reason the daemon stores: the Vitest adapter's, prefixed by the composite (`composite-runner.ts:182`). */
const adapterReason = (n: number) =>
  `vitest: ${withoutTouched(empty, [{ project: "", path: TEST }], artifacts(n)).failure}`;

const header: StatusHeader = {
  revision: 44,
  counts: { current: 0, pending: 0, stale: 0, unknown: 7 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
};

function delta(reason: string): Delta {
  const entries: TransitionEntry[] = Array.from({ length: 7 }, (_, i) => ({
    check: { kind: "test", project: "", testPath: TEST, fullName: `contrast > case ${i}` },
    kind: "to-unknown",
    from: "pass",
    to: "unknown",
    validity: "unknown",
    observedAt: 44,
    origin: { kind: "own" },
    summary: reason,
    location: null,
  }));
  return {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header,
    label: "transitions",
    entries,
  };
}

describe("issue 13, formatter reproduction", () => {
  it("cuts the reason before its explanation, at 300 characters", () => {
    const reason = adapterReason(660);
    const text = formatDelta(delta(reason));
    console.log(`reason length: ${reason.length}`);
    console.log(`explanation starts at character ${reason.indexOf(EXPLANATION)}`);
    console.log(`--- delivered (${text.length} chars) ---\n${text}\n--- end ---`);
    expect(reason).toContain(EXPLANATION);
    expect(text).not.toContain(EXPLANATION);
    expect(text).not.toContain("task 001-159");
    expect(text).not.toContain(" why ");
  });

  it("names the smallest path count that hides the explanation", () => {
    const hidden = Array.from({ length: 20 }, (_, i) => i + 1).find(
      (n) => !formatDelta(delta(adapterReason(n))).includes(EXPLANATION),
    );
    console.log(`explanation hidden from ${hidden} paths of ${artifacts(1)[0]?.length} characters`);
    expect(hidden).toBeDefined();
  });

  it("status prints the whole reason, once per listed file", () => {
    const reason = adapterReason(660);
    const line = unknownFileText({
      testFile: { project: "", path: TEST },
      ran: false,
      reason,
      samples: [],
    });
    console.log(`status unknown-file line: ${line.length} chars; explanation at ${line.indexOf(EXPLANATION)}`);
    expect(line.length).toBeGreaterThan(30_000);
  });

  it("the scheduler's own barrier reason lists every path too; its note is bounded", () => {
    const failure = withheldForTouch(empty, artifacts(660)).failure ?? "";
    const note =
      withholdNote(artifacts(660), [{ file: { id: TEST, ref: { project: "", path: TEST } }, key: "k" }], false) ?? "";
    console.log(`withheldForTouch reason: ${failure.length} chars`);
    console.log(`withholdNote: ${note.length} chars: ${note}`);
    expect(failure.length).toBeGreaterThan(30_000);
    expect(note.length).toBeLessThan(600);
  });
});
