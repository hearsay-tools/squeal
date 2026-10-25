import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { DaemonLiveness, EpochMs, StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Row 011-211 (gh-90): a stop's line names `squeal hold -- <command>` for a manual run across
// edits. The sentence is the line's last, in every form from the product's own formatters:
// status's default text and `--full` (its `Outstanding:` line and its `Daemon:` line), a
// registration, a stop's delivery and a full delivery header. Read plain and in a Claude Code
// hook's JSON, each form gives the evals parser the same evidence as it did without the sentence
// (lessons: 0.1.197's B2 slipped past fixtures).

const NOW = 20_000 as EpochMs;
const STOPPED: DaemonLiveness = { state: "down", since: 1_000 as EpochMs, stopped: true };
const HOLD =
  "For a manual run across edits, `squeal hold -- <command>` holds validation until the command exits.";

const snapshot: StatusSnapshot = {
  ...settled,
  counts: { current: 30, pending: 1, stale: 0, unknown: 0 },
  testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 0 },
  daemon: STOPPED,
};
const header = {
  revision: snapshot.revision,
  counts: snapshot.counts,
  testFilesWithoutChecks: snapshot.testFilesWithoutChecks,
  fullSuite: snapshot.fullSuite,
  daemon: STOPPED,
};
const delta = {
  schemaVersion: 1,
  consumer: { worktreeId: "w1", sessionId: "s1", agentId: "main" },
  header,
  label: "transitions",
  entries: [],
  liveness: STOPPED,
} as never;

/** Each form the row changes, from its formatter; a line in it that carries the sentence; how many do. */
const forms: [string, string, RegExp, number][] = [
  ["status", formatStatus(snapshot, NOW), /^ {2}.*stopped by request .*\.$/m, 1],
  [
    "status --full",
    formatStatus(snapshot, NOW, "squeal", { full: true }),
    /^Daemon: stopped by request .*\.$/m,
    2,
  ],
  [
    "a registration",
    formatRegistration({ header, knownFailures: [] } as never),
    /The daemon is stopped by request .*\.$/m,
    1,
  ],
  ["a stop's delivery", formatDelta(delta), /The daemon is stopped by request .*\.$/m, 1],
  [
    "a full delivery header",
    formatDelta(delta, "squeal", undefined, "full"),
    /The daemon is stopped by request .*\.$/m,
    1,
  ],
];
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each(forms)("a stopped daemon's %s (row 011-211)", (_form, text, line, count) => {
  it("ends the stop's line with the hold for a manual run across edits", () => {
    const stop = line.exec(text)?.[0];
    expect(stop).toBeDefined();
    expect(stop?.endsWith(` ${HOLD}`)).toBe(true);
    expect(text.split(HOLD)).toHaveLength(count + 1);
  });

  it.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("reads %s as it did without the sentence", (_how, wrap) => {
    const evidence = squealEvidence(wrap(text), "pull");
    expect(evidence).toEqual(squealEvidence(wrap(text.replaceAll(` ${HOLD}`, "")), "pull"));
    expect(evidence).toMatchObject({ revision: snapshot.revision });
  });
});
