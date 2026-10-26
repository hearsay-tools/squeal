import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import type { CliIo } from "../../src/cli/main.js";
import type { NamedFile } from "../../src/cli/named-files.js";
import { printNamed } from "../../src/cli/named-print.js";
import type { EndedNamed } from "../../src/cli/status-wait-lines.js";
import { A, NOW, ref } from "../cli/status-wait-fixture.js";
import { ended, ISSUE_99, NINE, SYNCED } from "../cli/wait-again-fixture.js";

// Row 011-243 (gh-99): each named line with no verdict that the row changed, from the product's
// own printer, plain and `--json` (the snapshot on stdout, the lines on stderr), each as text and
// in a Claude Code hook's JSON, read by the evals: no selected file credited, no verdict, the
// revision the line names, and the work it waits for counted pending, or no daemon validating.

/** A file running in the vitest lane, as the worktree's own counts say too. */
const RUNNING = ended([A], "timeout", 4, {
  verdict: { byClass: { current: 0, pending: 1, stale: 0, unknown: 0 } },
  files: [
    {
      testFile: ref(A),
      state: "pending",
      pending: { kind: "running", lane: "vitest", since: null },
    },
  ] as NamedFile[],
  result: {
    testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 0 },
    testFilesByPhase: { running: 1, queued: 0 },
  },
});

const cases: [string, EndedNamed, { daemon: boolean }][] = [
  ["#99: revision 7 not listed, the passes at 6", ISSUE_99, { daemon: true }],
  [
    "the daemon's pass not stored",
    ended(NINE.slice(0, 2), "timeout", 42, { sync: { state: "pending" } }),
    { daemon: true },
  ],
  [
    "the daemon's pass past the results",
    ended([A], "timeout", 4, { sync: SYNCED(5) }),
    { daemon: true },
  ],
  [
    "a snapshot whose pass is not stored",
    ended([A], "timeout", 4, { snapshot: true, sync: { state: "pending" } }),
    { daemon: true },
  ],
  ["a pending tier", RUNNING, { daemon: true }],
  [
    "no daemon",
    ended([A], "no-daemon", 4, {
      down: "stopped",
      result: { daemon: { state: "not-validating", since: NOW - 60_000 } as never },
    }),
    { daemon: false },
  ],
];

/** `printNamed`'s output for `wait`: stdout, and with `--json` the snapshot then the lines. */
async function printed(wait: EndedNamed, json: boolean) {
  let out = "";
  const io: CliIo = { stdout: (t) => (out += t), stderr: (t) => (out += t), env: {} };
  const code = await printNamed(Promise.resolve(wait), { json }, io, () => NOW);
  return { code, out };
}

const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each(cases)("a named wait with no verdict, %s (row 011-243)", (_, wait, { daemon }) => {
  describe.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("%s", (__, wrap) => {
    it.each([false, true])("with --json %s: no file credited, no verdict", async (json) => {
      const { code, out } = await printed(wait, json);
      expect(code).toBe(3);
      expect(out).toMatch(daemon ? /A later pass is not reported\./ : /once a daemon runs/);
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], verdict: "unknown", daemon });
      expect(step).not.toHaveProperty("selected");
      if (daemon) expect(step?.pending).toBeGreaterThan(0);
      // The text names the wait's revision first; `--json`'s lines name none of their own.
      if (!json) expect(step?.revision).toBe(wait.result.revision);
    });
  });
});

describe("a snapshot whose daemon did not answer its sync, the worktree clear (row 011-243)", () => {
  // A misread before this row: `squealEvidence` read it as pending 0 and `pass`, while it exits 3.
  const unanswered = ended([A], "timeout", 4, { snapshot: true, sync: { state: "unsupported" } });
  const old =
    "Revision: 4\nSelected: src/a.test.ts\nNamed test files have no verdict: results are as of revision 4; the daemon did not answer its sync, so they may not hold the latest edits. Worktree: known failures 0; 6 test files current";

  it.each([false, true])("with --json %s reads as pending, no verdict", async (json) => {
    const { code, out } = await printed(unanswered, json);
    expect(code).toBe(3);
    expect(out).toContain("the daemon did not answer its sync");
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], verdict: "unknown", daemon: true });
      expect(step?.pending).toBeGreaterThan(0);
    }
  });

  it("reads 0.1.333's words as pending, no verdict", () => {
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(old), "pull");
      expect(step).toMatchObject({ revision: 4, files: [], verdict: "unknown" });
      expect(step?.pending).toBeGreaterThan(0);
    }
  });
});
