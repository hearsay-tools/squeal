import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { DaemonLiveness, EpochMs, StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Row 011-254 (gh-104): a stop `--until-start` has its own line in every form the product's
// formatters give a plain stop: status's default text and `--full`, a registration, a stop's
// delivery and a full delivery header. Read plain and in a Claude Code hook's JSON, each form
// gives the evals parser the evidence the plain stop's form gives (lessons: 0.1.197's B2 slipped
// past fixtures).

const NOW = 20_000 as EpochMs;
const PLAIN: DaemonLiveness = { state: "down", since: 1_000 as EpochMs, stopped: true };
const MODE: DaemonLiveness = { ...PLAIN, untilStart: true };
const NAMED = "stopped until `squeal start` (`squeal stop --until-start`)";

/** Each form, from its formatter, for the daemon `daemon`. */
function forms(daemon: DaemonLiveness): [string, string][] {
  const snapshot: StatusSnapshot = {
    ...settled,
    counts: { current: 30, pending: 1, stale: 0, unknown: 0 },
    testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 0 },
    daemon,
  };
  const header = {
    revision: snapshot.revision,
    counts: snapshot.counts,
    testFilesWithoutChecks: snapshot.testFilesWithoutChecks,
    fullSuite: snapshot.fullSuite,
    daemon,
  };
  const delta = {
    schemaVersion: 1,
    consumer: { worktreeId: "w1", sessionId: "s1", agentId: "main" },
    header,
    label: "transitions",
    entries: [],
    liveness: daemon,
  } as never;
  return [
    ["status", formatStatus(snapshot, NOW)],
    ["status --full", formatStatus(snapshot, NOW, "squeal", { full: true })],
    ["a registration", formatRegistration({ header, knownFailures: [] } as never)],
    ["a stop's delivery", formatDelta(delta)],
    ["a full delivery header", formatDelta(delta, "squeal", undefined, "full")],
  ];
}

const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

const plain = new Map(forms(PLAIN));

describe.each(forms(MODE))("a stop until `squeal start`: %s (row 011-254)", (form, text) => {
  it("names the mode and leaves out the plain stop's words", () => {
    expect(text).toContain(NAMED);
    expect(text).not.toContain("stopped by request");
    expect(text).not.toContain("hold -- <command>");
  });

  it.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("reads %s as the plain stop's form does", (_how, wrap) => {
    const evidence = squealEvidence(wrap(text), "pull");
    expect(evidence).toEqual(squealEvidence(wrap(plain.get(form) ?? ""), "pull"));
    expect(evidence).toMatchObject({ revision: settled.revision });
  });
});
