import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { testFileId } from "../../src/core/keys/index.js";
import { recordMoves } from "../../src/core/scheduler/rekeyed-moves.js";
import {
  type CheckKey,
  type DaemonRecord,
  daemonIncarnation,
  type PendingPhase,
  type RevisionNumber,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

export { later, timed } from "./wait-clock.js";

/*
 * A worktree at revision 4 for `status --wait`'s edit window (lessons, defect
 * 32, tasks 001-186 and 001-191), and a daemon whose store records the
 * re-keyed files (task 001-258).
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
  token: "live",
};

/** The live daemon's incarnation: the writer its commits name (task 001-268). */
export const INCARNATION = daemonIncarnation(LIVE);
/** Its commits' moves. */
export const BY_LIVE = { writer: INCARNATION };

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

/** `path`'s row, written as the daemon's commit writes it: with its re-key moves (001-268). */
export function key(store: Store, worktreeId: string, path: string, pending: PendingPhase | null) {
  const row = {
    worktreeId,
    testFile: ref(path),
    key: `key-${path}-${pending ?? "done"}` as CheckKey,
    revision: 4 as RevisionNumber,
    pending,
  };
  store.transaction(() => {
    store.testFileKeys.upsertMany([row]);
    recordMoves(store, worktreeId, [], [], 4 as RevisionNumber, NOW, BY_LIVE);
  });
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

/** A path re-keyed at revision 4, or a path and its revision, and whether its move had its result since the wait started. */
type Named = string | [string, number] | [string, number, "resolved"];

/**
 * A daemon that answers the pass at revision 4 `answerMs` after it is asked.
 * Asked, after the wait read its start, it records `rekeyed` in the store's
 * re-key moves as the scheduler's commits would: each move open, then the
 * resolved ones resolved (task 001-258). `null`: a daemon that records no
 * moves. Counts the asks.
 */
export function answering(
  store: Store,
  worktreeId: string,
  rekeyed: readonly Named[] | null,
  current?: SyncState,
  answerMs = 0,
) {
  const asked: true[] = [];
  const marks = (rekeyed ?? []).map((file) => {
    const [path, revision, resolved] = typeof file === "string" ? [file, 4] : file;
    return { id: testFileId(ref(path)), revision, resolved: resolved !== undefined };
  });
  const state: SyncState = current ?? {
    state: "synced",
    revision: 4 as RevisionNumber,
    incarnation: rekeyed === null ? null : INCARNATION,
  };
  const sync = (): DaemonSync => {
    asked.push(true);
    let recorded = rekeyed === null;
    // After the wait's read transaction, which asked: the daemon's commits come from elsewhere.
    setTimeout(() => {
      if (recorded) return;
      store.transaction(() => {
        const opened = marks.map(({ id, revision }) => ({ id, open: revision, moved: revision }));
        recordMoves(store, worktreeId, opened, [], 4 as RevisionNumber, NOW, BY_LIVE);
        const resolved = marks.filter((mark) => mark.resolved);
        const closed = resolved.map(({ id }) => ({ id, open: null, moved: null }));
        recordMoves(store, worktreeId, closed, [], 4 as RevisionNumber, NOW, BY_LIVE);
      });
      recorded = true;
    }, 0);
    const at = performance.now() + answerMs;
    return {
      current: () => (recorded && performance.now() >= at ? state : { state: "pending" }),
      stop: () => {},
    };
  };
  return { asked, sync };
}

/** `path`'s moves had their result, as a commit records it. */
export function resolveMoves(store: Store, worktreeId: string, path: string) {
  const mark = { id: testFileId(ref(path)), open: null, moved: null };
  store.transaction(() =>
    recordMoves(store, worktreeId, [mark], [], 4 as RevisionNumber, NOW, BY_LIVE),
  );
}

export const options = (sync: ReturnType<typeof answering>["sync"], timeoutMs = 5_000) => ({
  timeoutMs,
  pollMs: 20,
  now: () => NOW,
  sync,
});
