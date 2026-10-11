import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import {
  A,
  B,
  newerDaemon,
  pendingOf,
  row,
  type Worktree,
  worktree,
} from "./status-wait-successor-fixture.js";

/*
 * Task 001-268, as decided by the human (2026-10-11): a ledger's first
 * commit takes in what was left only after a daemon that did not write the
 * moves last. A wait that starts before the first commit of a daemon on a
 * fresh worktree, or of one that restarted after another of its kind, keeps
 * its window: it returns once its own files have their results, with B, a
 * baseline file with no move, still queued.
 */

/**
 * The daemon's sync, asked at the wait's first read: its first commit
 * (A's move, B queued), then the answer at revision 4, then A's result.
 */
function firstCommitThenAnswer(h: Awaited<ReturnType<typeof newerDaemon>>) {
  return (): DaemonSync => {
    let state: SyncState = { state: "pending" };
    setTimeout(() => {
      h.commit([row(A, "a-1", "queued"), row(B, "b-1", "queued")], [A], true);
      state = { state: "synced", revision: 4 as RevisionNumber, incarnation: h.incarnation };
      setTimeout(() => h.commit([row(A, "a-1", null)]), 100);
    }, 0);
    return { current: () => state, stop: () => {} };
  };
}

async function waitOver(w: Worktree, h: Awaited<ReturnType<typeof newerDaemon>>) {
  const wait = await waitForStatus(w.repo.main, {
    timeoutMs: 3_000,
    pollMs: 20,
    sync: firstCommitThenAnswer(h),
  });
  expect(pendingOf(w.store, w.id, B)).toBe("queued");
  return wait;
}

describe("status --wait across a daemon's first commit (task 001-268)", () => {
  it("returns on its own files on a fresh worktree, which takes nothing in", async () => {
    const w = await worktree(4);
    const wait = await waitOver(w, await newerDaemon(w));
    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
  });

  it("returns on its own files after a restart from one newer daemon to another", async () => {
    const w = await worktree(4);
    const first = await newerDaemon(w, 1);
    first.commit([row(A, "a-0", null)], [], true);
    await first.close();
    const wait = await waitOver(w, await newerDaemon(w, 3));
    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
  });

  it("returns on its own files after the newer daemon before it exited cleanly", async () => {
    const w = await worktree(4);
    const first = await newerDaemon(w, 1);
    first.commit([row(A, "a-0", null)], [], true);
    await first.close();
    // Its record cleared on exit, which keeps its identity in the row.
    w.store.worktrees.setDaemon(w.id, null);
    const wait = await waitOver(w, await newerDaemon(w, 3));
    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
  });

  // Control: after a registration the moves' writer is not, the wait falls back.
  it("falls back when the daemon registered before did not write the moves", async () => {
    const w = await worktree(4);
    const first = await newerDaemon(w, 1);
    first.commit([row(A, "a-0", null)], [], true);
    await first.close();
    w.store.worktrees.setDaemon(w.id, { ...first.record, squealVersion: "0.1.112", startedAt: 2 });
    const wait = await waitOver(w, await newerDaemon(w, 3));
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });
});
