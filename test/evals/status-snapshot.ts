import type { StatusSnapshot } from "../../src/core/types/index.js";

// `squeal status --json` as the runner keeps it in `out/status-end.json`, typed against the
// product's contract so a change to it shows here.

/** A snapshot of a worktree whose every check is current and passing, with a live daemon. */
export const settled: StatusSnapshot = {
  schemaVersion: 1,
  available: true,
  worktreeId: "w1" as StatusSnapshot["worktreeId"],
  worktreeRoot: "/tmp/cell/work" as StatusSnapshot["worktreeRoot"],
  revision: 3,
  counts: { current: 31, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
  testFilesListed: true,
  inheritedCount: 0,
  refinedRevision: 3,
  runnerPartPending: false,
  head: null,
  dirty: true,
  dirtyObservedAt: 3,
  daemon: { state: "alive", lastHeartbeatAt: 1_000 as never },
  knownFailures: [],
  inherited: { count: 0, sources: [] },
  breakdown: {
    currentByOutcome: { pass: 31, fail: 0, skip: 0, unknown: 0 },
    pendingByPhase: { queued: 0, running: 0 },
    testFiles: 6,
    testFilesWithoutChecks: 0,
  },
  closureMethod: "static-import-graph" as StatusSnapshot["closureMethod"],
  storeSchemaVersion: 1,
  notes: [],
  daemonNotes: [],
};
