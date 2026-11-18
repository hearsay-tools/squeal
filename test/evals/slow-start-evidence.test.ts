import { describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import type { EpochMs } from "../../src/core/types/common.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";
import { settled } from "./status-snapshot.js";

// Rows 005-108 and 005-111 (row 005-122, quality slice 9): a daemon that holds the lock in a
// start past a minute, or whose starting process is stopped, validates nothing, so its title and
// its header sentence read as no daemon validating, from the product's own formatters, plain
// and in a Claude Code hook's JSON. No line here is written by hand (0.1.197's review B2).

const SINCE = 1_000 as EpochMs;
const STARTING = { state: "down", since: null, startingSince: SINCE, startMark: "start" } as const;
const cases: [string, DaemonLiveness, RegExp, RegExp][] = [
  [
    "slow",
    { ...STARTING, startSlow: true },
    /^SQUEAL · a daemon is still starting at revision 3\n/,
    /A daemon has been starting since \d{2}:\d{2}:\d{2} UTC/,
  ],
  [
    "stopped",
    { ...STARTING, startStopped: true },
    /^SQUEAL · a starting daemon may be stopped at revision 3\n/,
    /A daemon has been starting since \d{2}:\d{2}:\d{2} UTC, and it may be stopped/,
  ],
];

const header = (daemon: DaemonLiveness, listed: boolean) => ({
  revision: settled.revision,
  counts: settled.counts,
  testFilesWithoutChecks: settled.testFilesWithoutChecks,
  fullSuite: settled.fullSuite,
  daemon,
  ...(listed ? {} : { testFilesListed: false }),
});
const delta = (daemon: DaemonLiveness, listed: boolean) =>
  ({
    schemaVersion: 1,
    consumer: { worktreeId: "w1", sessionId: "s1", agentId: "main" },
    header: header(daemon, listed),
    label: "transitions",
    entries: [],
    liveness: daemon,
  }) as never;
const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each(cases)("a start that is %s (rows 005-108, 005-111)", (_, daemon, title, sentence) => {
  const forms: [string, string, RegExp][] = [true, false].flatMap((listed) => {
    const listing = listed ? "listed" : "unlisted";
    return [
      [`a liveness delivery, ${listing}`, formatDelta(delta(daemon, listed)), title],
      [
        `a full delivery header, ${listing}`,
        formatDelta(delta(daemon, listed), "squeal", undefined, "full"),
        sentence,
      ],
      [
        `a registration, ${listing}`,
        formatRegistration({ header: header(daemon, listed), knownFailures: [] } as never),
        sentence,
      ],
    ] as [string, string, RegExp][];
  });

  it.each(forms)("%s says it in the formatter's own text", (_form, text, line) => {
    expect(text).toMatch(line);
  });

  describe.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("%s", (__, wrap) => {
    it.each(forms)("%s reads as no daemon validating", (_form, text) => {
      expect(squealEvidence(wrap(text), "pull")).toMatchObject({ daemon: false });
    });
  });
});
