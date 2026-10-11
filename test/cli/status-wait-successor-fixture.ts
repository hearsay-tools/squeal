import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach } from "vitest";
import { syncDaemon } from "../../src/cli/status-sync.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { testFileId } from "../../src/core/keys/index.js";
import { adoptsAtFirstCommit, recordMoves } from "../../src/core/scheduler/rekeyed-moves.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import {
  type AbsolutePath,
  type CheckKey,
  type DaemonRecord,
  daemonIncarnation,
  predecessorIncarnation,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileKeyRecord,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Reviews wave 13ac and 13ad, B1 (tasks 001-265, 001-268): daemons that
 * succeed one another under a wait. A newer one serves the production sync
 * over a real socket from its front desk, and its commits write what its
 * ledger's do, the store's re-key moves included. An older one, before task
 * 001-258, registers and writes the rows, the legacy re-key record, the
 * states and the refined revision; never the moves. Each reads the
 * registration before its own, as the daemon does (task 001-268). A newer
 * one draws a start token, as the daemon does (task 001-270); an older one
 * none.
 */

export const A = "src/a.test.ts";
export const B = "src/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export function daemon(
  socketPath: string,
  version: string,
  startedAt: number,
  token?: string,
): DaemonRecord {
  return {
    socketPath: socketPath as AbsolutePath,
    startedAt,
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 600_000,
    squealVersion: version,
    ...(token === undefined ? {} : { token }),
  };
}

export function row(path: string, key: string, pending: "queued" | null): TestFileKeyRecord {
  return {
    worktreeId: "",
    testFile: ref(path),
    key: key as CheckKey,
    revision: 4 as RevisionNumber,
    pending,
  };
}

export type Worktree = Awaited<ReturnType<typeof worktree>>;

/** A worktree at revision 4, refined to `refined`, on which no daemon ever registered. */
export async function worktree(refined: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  cleanups.push(() => store.close());
  const dir = mkdtempSync("/tmp/sq-succ-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  store.meta.set(refinedMetaKey(repo.mainId), String(refined));
  return { repo, store, id: repo.mainId, dir };
}

/** Registers `record` on `w` as a daemon's start does; the incarnation registered before it. */
function register(w: Worktree, record: DaemonRecord): string | null | undefined {
  const existing = w.store.worktrees.get(w.id);
  const predecessor = predecessorIncarnation(existing !== null, w.store.worktrees.lastDaemon(w.id));
  w.store.worktrees.upsert({
    id: w.id,
    root: w.repo.main,
    commonDir: w.repo.commonDir,
    isMain: true,
    registeredAt: existing?.registeredAt ?? 1,
    daemon: record,
  });
  return predecessor;
}

/**
 * A newer daemon, started at `startedAt`, registered and serving `w`; its
 * sync captures 4. `commit` is one of its ledger's commits; `first` its
 * first, which takes in what the writers before it left pending unless the
 * daemon registered before wrote the moves last (`adoptsAtFirstCommit`).
 */
export async function newerDaemon(w: Worktree, startedAt = 1) {
  const token = randomUUID();
  const socketPath = join(w.dir, `d${startedAt}-${token.slice(0, 8)}.sock`) as AbsolutePath;
  const identity = { worktreeId: w.id, root: w.repo.main, squealVersion: "0.1.115", startedAt };
  const desk = await prepareFrontDesk(null).open(
    { ...identity, socketPath, token },
    {
      onActivity: () => {},
      requestFullSuite: () => new Promise(() => {}),
      requestSlowSuite: () => new Promise(() => {}),
      requestSync: () => Promise.resolve({ revision: 4 as RevisionNumber }),
      onStop: () => {},
      onStepDown: () => {},
      onFailure: () => {},
    },
  );
  let open = true;
  const close = async () => {
    if (open) await desk.close();
    open = false;
  };
  cleanups.push(close);
  desk.setPhase("ready");
  const record = daemon(socketPath, "0.1.115", startedAt, token);
  const predecessor = register(w, record);
  const writer = daemonIncarnation(record);
  const commit = (rows: TestFileKeyRecord[], open: string[] = [], first = false) =>
    w.store.transaction(() => {
      const adopts = first && adoptsAtFirstCommit(w.store, w.id, predecessor);
      const before = adopts ? w.store.testFileKeys.list(w.id) : undefined;
      const owned = rows.map((r) => ({ ...r, worktreeId: w.id }));
      w.store.testFileKeys.upsertMany(owned);
      const marks = open.map((path) => ({ id: testFileId(ref(path)), open: 4, moved: 4 }));
      recordMoves(w.store, w.id, marks, [], 4 as RevisionNumber, Date.now(), {
        writer,
        ...(before === undefined ? {} : { before }),
      });
      states(w.store, w.id, owned);
    });
  return { ...w, close, commit, incarnation: writer, record };
}

/** Each row's check: pending while its row is, else a pass seen at revision 4. */
function states(store: Store, id: string, rows: readonly TestFileKeyRecord[]) {
  store.knownStates.upsertMany(
    rows.map((r) =>
      state(id, check(r.testFile.path, "holds"), {
        validity: r.pending === null ? "current" : "pending",
        pendingPhase: r.pending,
        observedAt: r.pending === null ? 4 : 3,
      }),
    ),
  );
}

/** A daemon before task 001-258 registers, after `close` stopped the one serving. */
export async function olderSuccessor(w: Worktree & { close: () => Promise<void> }) {
  await w.close();
  register(w, daemon("/tmp/sq-succ-gone.sock", "0.1.112", 2));
}

/**
 * One of its ledger's commits: rows, the legacy re-key record, states and,
 * with `refined`, the refined revision; never the re-key moves.
 */
export function olderCommit(
  w: Worktree,
  rows: TestFileKeyRecord[],
  rekeyed: string[],
  refined: number | null = null,
) {
  w.store.transaction(() => {
    const owned = rows.map((r) => ({ ...r, worktreeId: w.id }));
    w.store.testFileKeys.upsertMany(owned);
    const marks = rekeyed.map((path) => ({ id: testFileId(ref(path)), open: 4, moved: 4 }));
    recordRekeyed(w.store, w.id, marks, []);
    states(w.store, w.id, owned);
    if (refined !== null) w.store.meta.set(refinedMetaKey(w.id), String(refined));
  });
}

/** The production sync, and a call of `then` once, after the read in which it first answered. */
export function syncThen(then: () => Promise<void>) {
  let fired = false;
  return (root: AbsolutePath, pollMs: number) => {
    const sync = syncDaemon(root, pollMs);
    return {
      current: () => {
        const current = sync.current();
        if (current.state === "synced" && !fired) {
          fired = true;
          setImmediate(() => void then());
        }
        return current;
      },
      stop: sync.stop,
    };
  };
}

export const pendingOf = (store: Store, id: string, path: string) =>
  store.testFileKeys.list(id).find((r) => r.testFile.path === path)?.pending;
