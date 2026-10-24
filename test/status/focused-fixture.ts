import { type FocusedRun, writeFocused } from "../../src/core/scheduler/focused-row.js";
import {
  type CheckId,
  type CheckKey,
  type EpochMs,
  type PendingPhase,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { appendRevisions, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Row 011-146: a live worktree at revision 4 and focused runs as the daemon
 * writes them in the meta row (row 011-145), for status, `why` and the wait.
 */

export const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
export const PARITY = "src/parity.test.ts";
export const OTHER = "src/other.test.ts";
export const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
export const keyOf = (path: string, n = 1) => `key-${path}-${n}` as CheckKey;
export const test = (path: string, fullName: string): CheckId => ({
  kind: "test",
  project: "",
  testPath: path,
  fullName,
});

/** A live worktree at revision 4, its runner part done. */
export function worktree() {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/tmp/squeal-focused.sock",
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  store.meta.set(refinedMetaKey(repo.mainId), "4");
  return { repo, store, id: repo.mainId };
}

/** `path` keyed at `key` in `phase` (`null`: current), with checks `names` in it. */
export function seedFile(
  store: Store,
  id: string,
  path: string,
  phase: PendingPhase | null,
  names: readonly string[] = ["holds"],
  key: CheckKey = keyOf(path),
) {
  store.testFileKeys.upsertMany([
    { worktreeId: id, testFile: ref(path), key, revision: 4 as RevisionNumber, pending: phase },
  ]);
  store.knownStates.upsertMany(
    names.map((name) =>
      state(
        id,
        test(path, name),
        phase === null
          ? { observedAt: 4 }
          : { validity: "pending", pendingPhase: phase, observedAt: 3 },
      ),
    ),
  );
}

/** A completed focused run of `path` at its key: `fails` failed, `passes` passed. */
export function focusedRun(
  path: string,
  over: Partial<FocusedRun> & { fails?: readonly string[]; passes?: readonly string[] } = {},
): FocusedRun {
  const { fails = ["claude U2 ci and timer open"], passes = [], ...rest } = over;
  const checks = [
    ...fails.map((name) => ({
      check: test(path, name),
      outcome: "fail" as const,
      durationMs: 1_200,
      summary: "AssertionError: expected 'a' to contain 'b'",
      location: { path: path as never, line: 30, column: 22 },
      fingerprint: "AssertionError" as never,
    })),
    ...passes.map((name) => ({
      check: test(path, name),
      outcome: "pass" as const,
      durationMs: 400,
      summary: null,
      location: null,
      fingerprint: null,
    })),
  ];
  return {
    testFile: ref(path),
    key: keyOf(path),
    revision: 4 as RevisionNumber,
    texts: ["claude U"],
    runId: "run-focused",
    logDir: "/tmp/squeal-logs/run-focused",
    startedAt: (NOW - 10_000) as EpochMs,
    endedAt: (NOW - 2_200) as EpochMs,
    end: "completed",
    reason: null,
    collected: 78,
    matched: checks.length,
    checks,
    more: 0,
    ...rest,
  };
}

/** Writes `runs` into the worktree's focused meta row. */
export function writeRuns(store: Store, id: string, runs: readonly FocusedRun[]) {
  writeFocused(store, id as never, runs);
}
