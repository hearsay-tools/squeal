import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import type {
  CheckKey,
  DaemonRecord,
  PendingPhase,
  RevisionNumber,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * A worktree at revision 4 for `status --wait`'s edit window (lessons, defect
 * 32, tasks 001-186 and 001-191), and a daemon that names the re-keyed files.
 */

export const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
export const A = "src/a.test.ts";
export const B = "src/b.test.ts";
export const C = "src/c.test.ts";
export const SLOW_FILE = "test/slow.test.ts";
export const ref = (path: string): TestFileRef => ({ project: "", path: path as never });
export const ADDS = check(A, "adds");
export const BACKLOG = check(B, "holds");

const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-test.sock",
  startedAt: NOW - 60_000,
  heartbeatAt: NOW - 1_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
};

/**
 * A worktree at revision 4, the edit's, with `pending` test files queued and
 * their checks pending, each observed at `observed[path]`, else revision 3.
 */
export function repoWith(
  pending: readonly string[],
  done: readonly string[] = [],
  observed: Readonly<Record<string, number>> = {},
) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: LIVE,
  });
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  for (const path of pending) key(store, repo.mainId, path, "queued");
  for (const path of done) key(store, repo.mainId, path, null);
  store.knownStates.upsertMany(
    [...pending, ...done].map((path) =>
      state(repo.mainId, check(path, "holds"), {
        validity: pending.includes(path) ? "pending" : "current",
        pendingPhase: pending.includes(path) ? "queued" : null,
        observedAt: observed[path] ?? 3,
      }),
    ),
  );
  if (pending.includes(A) || done.includes(A)) {
    store.knownStates.upsertMany([
      state(repo.mainId, ADDS, {
        validity: pending.includes(A) ? "pending" : "current",
        pendingPhase: pending.includes(A) ? "queued" : null,
        observedAt: observed[A] ?? 3,
      }),
    ]);
  }
  return { repo, store };
}

export function key(store: Store, worktreeId: string, path: string, pending: PendingPhase | null) {
  store.testFileKeys.upsertMany([
    {
      worktreeId,
      testFile: ref(path),
      key: `key-${path}-${pending ?? "done"}` as CheckKey,
      revision: 4 as RevisionNumber,
      pending,
    },
  ]);
}

/** The file's run ended with the outcome it had: no transition. */
export function finish(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, null);
  const checks = path === A ? [ADDS, check(A, "holds")] : [check(path, "holds")];
  store.knownStates.upsertMany(checks.map((c) => state(worktreeId, c, { observedAt: 4 })));
}

export function fail(store: Store, worktreeId: string, c: ReturnType<typeof check>) {
  store.knownStates.upsertMany([
    state(worktreeId, c, { outcome: "fail", observedAt: 4, fingerprint: "Error: x" }),
  ]);
}

export function later(ms: number, fn: () => void) {
  setTimeout(fn, ms);
}

/** A path re-keyed at revision 4, or a path and its revision, and whether its move had its result since the wait started. */
type Named = string | [string, number] | [string, number, "resolved"];

/**
 * A daemon that answers the pass at revision 4 `answerMs` after it is asked,
 * naming `rekeyed`; records the asked window.
 */
export function answering(rekeyed: readonly Named[] | null, current?: SyncState, answerMs = 0) {
  const asked: RevisionNumber[] = [];
  const named = (file: Named) => {
    const [path, revision, resolved] = typeof file === "string" ? [file, 4] : file;
    return {
      testFile: ref(path),
      revision: revision as RevisionNumber,
      ...(resolved === undefined ? {} : { resolved: true as const }),
    };
  };
  const state: SyncState = current ?? {
    state: "synced",
    revision: 4 as RevisionNumber,
    rekeyed: rekeyed === null ? null : rekeyed.map(named),
  };
  const sync = (_root: unknown, _pollMs: number, after: RevisionNumber): DaemonSync => {
    asked.push(after);
    const at = performance.now() + answerMs;
    return {
      current: () => (performance.now() >= at ? state : { state: "pending" }),
      stop: () => {},
    };
  };
  return { asked, sync };
}

export const options = (sync: ReturnType<typeof answering>["sync"], timeoutMs = 5_000) => ({
  timeoutMs,
  pollMs: 20,
  now: () => NOW,
  sync,
});
