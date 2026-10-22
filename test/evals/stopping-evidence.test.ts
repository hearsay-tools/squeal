import { describe, expect, it } from "vitest";
import { squealEvidence, squealState, trimOutput } from "../../evals/lib/index.mjs";
import {
  type EndedNamed,
  type EndedWait,
  namedText,
  waitText,
} from "../../src/cli/status-wait-lines.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { formatStatus } from "../../src/core/status/index.js";
import type {
  DaemonLiveness,
  DaemonStopping,
  EpochMs,
  StatusSnapshot,
} from "../../src/core/types/index.js";
import { settled } from "./status-snapshot.js";

// Row 011-34 (011 C9 as amended 2026-10-20): a daemon that stops or hands over validates
// nothing, so every line the row adds or changes reads as no daemon validating, from the
// product's own formatters, plain and in a Claude Code hook's JSON: status's default text and
// `--full`, a wait's verdict, a named wait's, a registration, a delivery and `--json`. 0.1.197
// slipped a parser break past fixtures (review B2), so no line here is written by hand.

const SINCE = 1_000 as EpochMs;
const NOW = (SINCE + 12_000) as EpochMs;
const HANDOFF: DaemonStopping = {
  from: "0.1.0",
  since: SINCE,
  to: "0.1.31",
  boundAt: (SINCE + 130_000) as EpochMs,
  overdue: false,
};
const STOPPING: DaemonStopping = { from: "0.1.0", since: SINCE, overdue: false };

/** The two heartbeat readings a stopping daemon has: fresh still, or stopped with the timers. */
const daemons = (stopping: DaemonStopping): [string, DaemonLiveness][] => [
  ["its heartbeat fresh", { state: "alive", lastHeartbeatAt: SINCE, stopping }],
  ["its heartbeat stopped", { state: "down", since: SINCE, stopping }],
];
const cases = [
  ...daemons(HANDOFF).map(([h, d]) => [`handing over, ${h}`, d] as const),
  ...daemons({ ...HANDOFF, overdue: true }).map(([h, d]) => [`past the bound, ${h}`, d] as const),
  ...daemons(STOPPING).map(([h, d]) => [`stopping, ${h}`, d] as const),
];

const snapshot = (daemon: DaemonLiveness): StatusSnapshot => ({ ...settled, daemon });
const header = (daemon: DaemonLiveness) => ({
  revision: settled.revision,
  counts: settled.counts,
  testFilesWithoutChecks: settled.testFilesWithoutChecks,
  fullSuite: settled.fullSuite,
  daemon,
});
const consumer = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const delta = (daemon: DaemonLiveness) =>
  ({
    schemaVersion: 1,
    consumer,
    header: header(daemon),
    label: "transitions",
    entries: [],
    liveness: daemon,
  }) as never;
const waited = (daemon: DaemonLiveness, outcome: "timeout" | "no-daemon") =>
  ({
    outcome,
    waitedMs: 1_500,
    transitions: 0,
    result: snapshot(daemon),
    ...(outcome === "no-daemon" ? { down: "handoff" } : {}),
  }) as EndedWait;
const named = (daemon: DaemonLiveness) => {
  const refs = [{ project: "", path: "test/a.test.ts" }];
  return {
    outcome: "no-daemon",
    down: "handoff",
    waitedMs: 1_500,
    selection: { files: refs, unmatched: [] },
    verdict: {
      revision: settled.revision,
      testFiles: 1,
      byClass: { current: 0, pending: 1, stale: 0, unknown: 0 },
      unlisted: false,
      failures: { tests: 0, testFiles: 0 },
    },
    files: refs.map((testFile) => ({ testFile, state: "pending", verdict: null })),
    sync: { state: "synced", revision: settled.revision, incarnation: null },
    result: snapshot(daemon),
  } as unknown as EndedNamed;
};

/** Each form the row changes, from its formatter, and the line in it that names the stop. */
const forms = (daemon: DaemonLiveness): [string, string, RegExp][] => [
  ["status", formatStatus(snapshot(daemon), NOW), /^ {2}the daemon is (?:handing|stopping)/m],
  [
    "status --full",
    formatStatus(snapshot(daemon), NOW, "squeal", { full: true }),
    /^Daemon: (?:handing over|stopping)/m,
  ],
  [
    "status --wait, timed out",
    waitText(waited(daemon, "timeout"), NOW),
    /; the daemon is (?:handing over|stopping) .*, so the wait went on/,
  ],
  [
    "status --wait past the bound",
    waitText(waited(daemon, "no-daemon"), NOW),
    /^Returned without a daemon: the handoff to 0\.1\.31 did not finish within 130 s/m,
  ],
  [
    "a named wait past the bound",
    namedText(named(daemon), NOW),
    /^Named test files have no verdict: the handoff to 0\.1\.31 did not finish within 130 s/m,
  ],
  [
    "a registration",
    formatRegistration({ header: header(daemon), knownFailures: [] } as never),
    / The daemon is (?:handing over|stopping) /,
  ],
  [
    "a liveness delivery",
    formatDelta(delta(daemon)),
    /^SQUEAL · the daemon is (?:handing over|stopping) at revision 3\n/,
  ],
  [
    "a full delivery header",
    formatDelta(delta(daemon), "squeal", undefined, "full"),
    / The daemon is (?:handing over|stopping) /,
  ],
];
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each(cases)("a daemon %s (row 011-34)", (_, daemon) => {
  // The past-bound wait lines come only with a handoff claim.
  const own = forms(daemon).filter(
    ([form]) => daemon.stopping?.to !== undefined || !form.includes("past the bound"),
  );

  it.each(own)("%s names it in the formatter's own text", (_form, text, line) => {
    expect(text).toMatch(line);
    expect(text).not.toMatch(/Daemon: running|validating again/);
  });

  describe.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("%s", (__, wrap) => {
    it.each(own)("%s reads as no daemon validating", (_form, text) => {
      expect(squealEvidence(wrap(text), "pull")).toMatchObject({ daemon: false });
    });
  });

  it("is no daemon validating in `--json`, never alive", () => {
    const json = JSON.stringify(snapshot(daemon));
    expect(squealState(json)).toMatchObject({
      daemon: false,
      verdict: "unknown",
      reasons: ["no daemon validating"],
    });
  });

  it("keeps the Outstanding line that names it whole in a trim", () => {
    const text = formatStatus(snapshot(daemon), NOW);
    const line = text.split("\n").find((l) => /^ {2}the daemon is /.test(l));
    if (line === undefined) throw new Error("no Outstanding line names the daemon");
    const filler = Array.from({ length: 400 }, (_, i) => `filler line ${i} `.repeat(4));
    const trimmed = trimOutput([...filler, text].join("\n"), true);
    expect(trimmed.split("\n")).toContain(line);
  });
});

describe("near variants stay a daemon validating (row 011-34)", () => {
  it("a settled status and its registration, a daemon serving", () => {
    const alive = settled.daemon;
    expect(squealEvidence(formatStatus(settled, NOW), "pull")).toMatchObject({ daemon: true });
    const registration = formatRegistration({ header: header(alive), knownFailures: [] } as never);
    expect(squealEvidence(registration, "pull")).toMatchObject({ daemon: true });
    expect(squealState(settled)).toMatchObject({ daemon: true, verdict: "pass" });
  });
});
