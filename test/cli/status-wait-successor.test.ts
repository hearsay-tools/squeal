import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncDaemon } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { testFileId } from "../../src/core/keys/index.js";
import { recordMoves } from "../../src/core/scheduler/rekeyed-moves.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import {
  type AbsolutePath,
  type CheckKey,
  type DaemonRecord,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileKeyRecord,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";

/*
 * Review wave 13ac, B1 (task 001-265): a newer daemon answers the wait's
 * sync (`moves: true`), then a daemon before task 001-258 succeeds it and
 * moves a key of the captured edit without writing the store's re-key
 * moves. The wait's sync is the production one, over a real socket, to the
 * daemon's front desk; the successor writes what that daemon's commit
 * writes: the row, the legacy re-key record, the states and the refined
 * revision. Its moves are its own, so the wait never ends quiet on them.
 */

const A = "src/a.test.ts";
const B = "src/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function daemon(socketPath: string, version: string, startedAt: number): DaemonRecord {
  return {
    socketPath: socketPath as AbsolutePath,
    startedAt,
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 600_000,
    squealVersion: version,
  };
}

function row(path: string, key: string, pending: "queued" | null): TestFileKeyRecord {
  return {
    worktreeId: "",
    testFile: ref(path),
    key: key as CheckKey,
    revision: 4 as RevisionNumber,
    pending,
  };
}

/** A worktree at revision 4, served by a newer daemon whose sync captures 4. */
async function newerDaemon(refined: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  cleanups.push(() => store.close());
  const dir = mkdtempSync("/tmp/sq-succ-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  const desk = await prepareFrontDesk(null).open(
    {
      socketPath,
      worktreeId: repo.mainId,
      root: repo.main,
      squealVersion: "0.1.115",
      startedAt: 1 as never,
    },
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
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: daemon(socketPath, "0.1.115", 1),
  });
  appendRevisions(store, repo.mainId, 4, { head: null, dirty: false });
  store.meta.set(refinedMetaKey(repo.mainId), String(refined));
  const id = repo.mainId;
  /** A commit of this daemon's ledger: rows, states, and its re-key moves. */
  const commit = (rows: TestFileKeyRecord[], open: string[] = []) =>
    store.transaction(() => {
      const owned = rows.map((r) => ({ ...r, worktreeId: id }));
      store.testFileKeys.upsertMany(owned);
      const marks = open.map((path) => ({ id: testFileId(ref(path)), open: 4, moved: 4 }));
      recordMoves(store, id, marks, [], 4 as RevisionNumber, Date.now(), {
        written: owned,
        unrecorded: [],
      });
      states(store, id, owned);
    });
  return { repo, store, id, close, commit };
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

/**
 * A daemon before task 001-258 replaces the newer one and commits as its
 * ledger did: rows, the legacy re-key record, states and, with `refined`,
 * the refined revision; never the re-key moves.
 */
async function olderSuccessor(
  h: Awaited<ReturnType<typeof newerDaemon>>,
  rows: TestFileKeyRecord[],
  rekeyed: string[],
  refined: number | null,
) {
  await h.close();
  h.store.worktrees.setDaemon(h.id, daemon("/tmp/sq-succ-gone.sock", "0.1.112", 2));
  h.store.transaction(() => {
    const owned = rows.map((r) => ({ ...r, worktreeId: h.id }));
    h.store.testFileKeys.upsertMany(owned);
    const marks = rekeyed.map((path) => ({ id: testFileId(ref(path)), open: 4, moved: 4 }));
    recordRekeyed(h.store, h.id, marks, []);
    states(h.store, h.id, owned);
    if (refined !== null) h.store.meta.set(refinedMetaKey(h.id), String(refined));
  });
}

/** The production sync, and a call of `then` once, after the read in which it first answered. */
function syncThen(then: () => Promise<void>) {
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

const pendingOf = (store: Store, id: string, path: string) =>
  store.testFileKeys.list(id).find((r) => r.testFile.path === path)?.pending;

describe("status --wait after an older daemon succeeds the one that synced (review wave 13ac, B1)", () => {
  it("never ends quiet when the successor refines the capture with a key it did not record", async () => {
    // A had its pass at revision 3; the runner part of revision 4 finds its new key.
    const h = await newerDaemon(3);
    h.commit([row(A, "a-1", null)]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(() => olderSuccessor(h, [row(A, "a-2", "queued")], [A], 4)),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("never ends quiet when the successor moves a key after the window was read", async () => {
    // The newer daemon refined revision 4: the window holds for B, whose key it moved.
    const h = await newerDaemon(4);
    h.commit([row(A, "a-1", null), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      // B has its result; A's environment grew at the same revision.
      sync: syncThen(() =>
        olderSuccessor(h, [row(B, "b-2", null), row(A, "a-2", "queued")], [A], null),
      ),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  // Control: the same commits by a ledger that records its moves hold the wait for A by name.
  it("holds for the key when the successor records its moves", async () => {
    const h = await newerDaemon(3);
    h.commit([row(A, "a-1", null)]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => {
        await h.close();
        h.commit([row(A, "a-2", "queued")], [A]);
        h.store.meta.set(refinedMetaKey(h.id), "4");
      }),
    });
    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 1 } });
  });
});
