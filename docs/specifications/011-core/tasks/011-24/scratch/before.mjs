// Throwaway (row 011-24): renders today's status, wait, header and Stop text for each
// finding's scenario by calling the shipped formatters on seeded snapshots. No store, no
// daemon, no Vitest. Run from the worktree root, see README.md.
const src = new URL("../../../../../../src/", import.meta.url);
const load = (path) => import(new URL(path, src).href);

const { formatStatus } = await load("core/status/format-status.ts");
const { namedText, waitText } = await load("cli/status-wait-lines.ts");
const { formatRegistration } = await load("core/delivery/format.ts");
const { statusText } = await load("harness/shared/text.ts");
const { waitsText } = await load("core/retry/text.ts");

const NOW = Date.UTC(2026, 9, 19, 16, 15, 0);
const test = (path, name) => ({ kind: "test", project: "", testPath: path, fullName: name });
const file = (path) => ({ project: "", path });

function snap(o = {}) {
  return {
    schemaVersion: 1,
    available: true,
    worktreeId: "w1",
    worktreeRoot: "/work/repo",
    revision: 26,
    counts: { current: 0, pending: 0, stale: 0, unknown: 0 },
    testFilesWithoutChecks: { pending: 0, unknown: 0 },
    fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    testFilesListed: true,
    inheritedCount: 0,
    refinedRevision: o.revision ?? 26,
    runnerPartPending: false,
    head: "64cf3a8f00000000000000000000000000000000",
    commit: { head: "64cf3a8f00000000000000000000000000000000", sinceHead: 1, dirty: true },
    dirty: true,
    dirtyObservedAt: o.revision ?? 26,
    daemon: { state: "alive", lastHeartbeatAt: NOW - 2_000 },
    knownFailures: [],
    inherited: { count: 0, sources: [] },
    breakdown: {
      currentByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
      pendingByPhase: { queued: 0, running: 0 },
      testFiles: 0,
      testFilesWithoutChecks: 0,
    },
    closureMethod: "static imports plus declared inputs",
    storeSchemaVersion: 1,
    notes: [],
    daemonNotes: [],
    ...o,
  };
}

const verdict = (revision, byClass, failures = { tests: 0, testFiles: 0 }) => ({
  revision,
  testFiles: Object.values(byClass).reduce((a, b) => a + b, 0),
  byClass: { current: 0, pending: 0, stale: 0, unknown: 0, ...byClass },
  unlisted: false,
  failures,
});

function named(o) {
  return {
    waitedMs: 500,
    selection: { files: o.files.map((f) => f.testFile), unmatched: [] },
    leftForPause: [],
    sync: { state: "synced", revision: o.result.revision, incarnation: null },
    ...o,
  };
}

const out = [];
const show = (title, text) => out.push(`### ${title}\n\n\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`);

// gh-45, scenario `zero`: no failure, 60 stale and 20 queued checks in 6 and 2 test files.
const zero = snap({
  counts: { current: 20, pending: 20, stale: 60, unknown: 0 },
  fileLevelCounts: { current: 0, pending: 0, stale: 0, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 20, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 20, running: 0 },
    fileLevelByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
    fileLevelByPhase: { queued: 0, running: 0 },
    testFiles: 10,
    testFilesWithoutChecks: 0,
  },
  daemon: { state: "alive", lastHeartbeatAt: NOW - 2_000 },
});
show("gh-45 zero: `squeal status`", formatStatus(zero, NOW));
const header = { ...zero };
show(
  "gh-45 zero: registration header",
  formatRegistration(
    { schemaVersion: 1, consumer: { worktreeId: "w1", sessionId: "s", agentId: "main" }, header, knownFailures: [] },
    10_000,
    "squeal",
    NOW,
  ),
);
show("gh-45 zero: Stop", statusText(header, [], "squeal"));

// gh-45, scenario `oldrev`: three failures observed at revision 6, current, pending and stale.
const failure = (path, validity) => ({
  check: test(path, path.replace(/^src\/|\.test\.ts$/g, "")),
  outcome: "fail",
  validity,
  observedAt: 6,
  summary: "AssertionError: expected 1 to be 2",
  fingerprint: "x",
  location: null,
  recorded: { worktreeId: "w1", worktreeRoot: "/work/repo", revision: 6, recordedAt: NOW - 3_600_000, loadPerCpu: 0.4 },
});
const oldrev = snap({
  counts: { current: 1, pending: 1, stale: 1, unknown: 0 },
  fileLevelCounts: { current: 0, pending: 0, stale: 0, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 0, fail: 1, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 1, running: 0 },
    fileLevelByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
    fileLevelByPhase: { queued: 0, running: 0 },
    testFiles: 3,
    testFilesWithoutChecks: 0,
  },
  knownFailures: [
    failure("src/moved-key.test.ts", "stale"),
    failure("src/queued.test.ts", "pending"),
    failure("src/same-key.test.ts", "current"),
  ],
});
show("gh-45 oldrev: `squeal status`", formatStatus(oldrev, NOW));

// gh-44, E1: a named wait on one edited node:test file; 24 other files never run under lookup-only.
const never = (n) => ({
  testFile: file(`test/f${String(n).padStart(2, "0")}.test.mjs`),
  ran: false,
  reason: "never run at this key: the baseline is lookup-only, so nothing queued it",
  samples: [],
});
const e1 = snap({
  revision: 1,
  refinedRevision: 1,
  dirtyObservedAt: 1,
  counts: { current: 3, pending: 0, stale: 0, unknown: 0 },
  fileLevelCounts: { current: 1, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 24 },
  breakdown: {
    currentByOutcome: { pass: 3, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    fileLevelByOutcome: { pass: 1, fail: 0, skip: 0, unknown: 0 },
    fileLevelByPhase: { queued: 0, running: 0 },
    testFiles: 25,
    testFilesWithoutChecks: 24,
  },
  fileLevelCounts: { current: 1, pending: 0, stale: 0, unknown: 0 },
  unknownTestFiles: { total: 24, files: Array.from({ length: 20 }, (_, i) => never(i + 2)) },
  runsOpen: 0,
  daemonNotes: [
    {
      at: NOW - 60_000,
      revision: 0,
      text: 'node-test project "unit": 1 test file(s) loaded nothing beyond themselves; declare their inputs in squeal.config.json',
    },
  ],
});
show(
  "gh-44 E1: `squeal status --wait 60000 test/f01.test.mjs` (exit 0)",
  namedText(
    named({
      outcome: "settled",
      verdict: verdict(1, { current: 1 }),
      files: [{ testFile: file("test/f01.test.mjs"), state: "current", verdict: "pass" }],
      result: e1,
    }),
    NOW,
  ),
);

// gh-38, A: a stale file under lookup-only, selected by a source path; nothing queued.
const stale = snap({
  revision: 2,
  refinedRevision: 2,
  dirtyObservedAt: 2,
  counts: { current: 2, pending: 0, stale: 4, unknown: 0 },
  fileLevelCounts: { current: 1, pending: 0, stale: 2, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 2, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    fileLevelByOutcome: { pass: 1, fail: 0, skip: 0, unknown: 0 },
    fileLevelByPhase: { queued: 0, running: 0 },
    testFiles: 3,
    testFilesWithoutChecks: 0,
  },
  runsOpen: 0,
});
show(
  "gh-38 A: `squeal status --wait 20000 src/lib.js` (exit 3)",
  namedText(
    named({
      outcome: "settled",
      verdict: verdict(2, { stale: 1 }),
      files: [{ testFile: file("tests/a.test.ts"), state: "stale", verdict: "pass" }],
      result: stale,
    }),
    NOW,
  ),
);

// gh-43: one file timed out in a tier of its own, `unknown`, nothing queued.
const timedOut = {
  testFile: file("test/slow.test.ts"),
  ran: false,
  reason: "timed out after 600 s",
  samples: [],
};
const t43 = snap({
  revision: 0,
  refinedRevision: 0,
  dirtyObservedAt: 0,
  testFilesWithoutChecks: { pending: 0, unknown: 1 },
  breakdown: {
    currentByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    testFiles: 1,
    testFilesWithoutChecks: 1,
  },
  unknownTestFiles: { total: 1, files: [timedOut] },
  runsOpen: 0,
});
show(
  "gh-43: `squeal status --wait 10000 test/slow.test.ts` (exit 3)",
  namedText(
    named({
      outcome: "settled",
      verdict: verdict(0, { unknown: 1 }),
      files: [{ testFile: file("test/slow.test.ts"), state: "unknown", unknown: timedOut }],
      result: t43,
    }),
    NOW,
  ),
);

// gh-40, run B: a 1.5 s wait on three fast files behind a running backlog tier and one slow file.
const tierStart = NOW - 4_000;
const t40 = snap({
  revision: 0,
  refinedRevision: 0,
  dirtyObservedAt: 0,
  testFilesWithoutChecks: { pending: 28, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    testFiles: 28,
    testFilesWithoutChecks: 28,
    testFilesWithoutChecksRunning: 4,
  },
  runsOpen: 1,
});
const behind = (p) => ({
  testFile: file(p),
  state: "pending",
  pending: { kind: "queued", lane: "vitest", behind: tierStart },
});
show(
  "gh-40 B: `squeal status --wait 1500 <3 fast files> <1 slow file>` (exit 3)",
  namedText(
    named({
      outcome: "timeout",
      waitedMs: 1_500,
      verdict: verdict(0, { pending: 4 }),
      files: [
        behind("tests/fast/f1.test.ts"),
        behind("tests/fast/f2.test.ts"),
        behind("tests/fast/f3.test.ts"),
        { testFile: file("tests/slow/s1.test.ts"), state: "pending", pending: { kind: "slow" } },
      ],
      result: t40,
    }),
    NOW,
  ),
);

// gh-40, run A: the named files inside a running 27-file backlog tier, not yet started.
const inTier = (p) => ({
  testFile: file(p),
  state: "pending",
  pending: { kind: "running", lane: "vitest", since: tierStart },
});
show(
  "gh-40 A: the same wait while the files sit in a running 27-file backlog tier (exit 3)",
  namedText(
    named({
      outcome: "timeout",
      waitedMs: 1_500,
      verdict: verdict(0, { pending: 3 }),
      files: [inTier("tests/fast/f1.test.ts"), inTier("tests/fast/f2.test.ts"), inTier("tests/fast/f3.test.ts")],
      result: snap({
        revision: 0,
        refinedRevision: 0,
        dirtyObservedAt: 0,
        testFilesWithoutChecks: { pending: 28, unknown: 0 },
        breakdown: {
          currentByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
          pendingByPhase: { queued: 0, running: 0 },
          testFiles: 28,
          testFilesWithoutChecks: 28,
          testFilesWithoutChecksRunning: 27,
        },
        runsOpen: 1,
      }),
    }),
    NOW,
  ),
);

// gh-41, E1: 553 queued files without checks, nothing running; a quiet edit wait over 91 files.
const t41 = snap({
  revision: 1,
  refinedRevision: 1,
  dirtyObservedAt: 1,
  counts: { current: 455, pending: 0, stale: 0, unknown: 0 },
  fileLevelCounts: { current: 91, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 553, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 455, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    fileLevelByOutcome: { pass: 91, fail: 0, skip: 0, unknown: 0 },
    fileLevelByPhase: { queued: 0, running: 0 },
    testFiles: 644,
    testFilesWithoutChecks: 553,
  },
  runsOpen: 0,
});
show(
  "gh-41 E1: `squeal status --wait 60000` (quiet)",
  waitText(
    {
      outcome: "quiet",
      waitedMs: 0,
      transitions: 0,
      edit: { since: 1, testFiles: 91, pending: 0, otherTransitions: 0 },
      result: t41,
    },
    NOW,
  ),
);
show("gh-41 comment: a load retry's wording at 7.45 on 24 CPUs", waitsText("load", { oneMinute: 7.45, cpus: 24 }));

// gh-39: a repo-relative path typed from a subdirectory, joined to the cwd.
show(
  "gh-39: `squeal status --wait 90000 packages/cezar/src/core/cursor-print-capabilities.test.ts` from packages/cezar (exit 3)",
  namedText(
    named({
      outcome: "unmatched",
      selection: {
        files: [],
        unmatched: ["packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts"],
      },
      verdict: verdict(20, {}),
      files: [],
      result: snap({ revision: 20, refinedRevision: 20, dirtyObservedAt: 20 }),
    }),
    NOW,
  ),
);

// gh-42, E2: `--wait 1` with no daemon on two test files without a result.
const down = snap({
  revision: 837,
  refinedRevision: 837,
  dirty: null,
  daemon: { state: "down", since: NOW - 600_000 },
  testFilesWithoutChecks: { pending: 0, unknown: 468 },
  breakdown: {
    currentByOutcome: { pass: 0, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    testFiles: 468,
    testFilesWithoutChecks: 468,
  },
  unknownTestFiles: {
    total: 468,
    files: [
      { testFile: file("test/cli/main.test.ts"), ran: false, reason: "no dependencies are installed in this worktree", samples: [] },
      { testFile: file("test/cli/remove.test.ts"), ran: false, reason: "no dependencies are installed in this worktree", samples: [] },
    ],
  },
});
const noDeps = (p) => ({
  testFile: file(p),
  state: "unknown",
  unknown: { testFile: file(p), ran: false, reason: "no dependencies are installed in this worktree", samples: [] },
});
show(
  "gh-42 E2: `squeal status --wait 1 test/cli/main.test.ts test/cli/remove.test.ts` (exit 3)",
  namedText(
    named({
      outcome: "no-daemon",
      down: "stopped",
      verdict: verdict(837, { unknown: 2 }),
      files: [noDeps("test/cli/main.test.ts"), noDeps("test/cli/remove.test.ts")],
      result: down,
    }),
    NOW,
  ),
);

// gh-46: a slow e2e file running in the slow tier; then its refused connection, counted.
const slowRunning = snap({
  revision: 0,
  refinedRevision: 0,
  dirtyObservedAt: 0,
  counts: { current: 3, pending: 1, stale: 0, unknown: 0 },
  breakdown: {
    currentByOutcome: { pass: 3, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 1 },
    testFiles: 3,
    testFilesWithoutChecks: 0,
  },
  slowTier: {
    testFiles: 1,
    current: 0,
    pending: 1,
    notRun: 0,
    currentAt: null,
    activity: { kind: "running", path: "e2e/held.e2e.ts", since: NOW - 3_000, lastDurationMs: null },
  },
  runsOpen: 1,
});
show("gh-46: `squeal status` while the slow file runs", formatStatus(slowRunning, NOW));

process.stdout.write(out.join("\n"));
