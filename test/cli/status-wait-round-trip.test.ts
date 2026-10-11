import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { refinedMetaKey } from "../../src/core/types/index.js";
import {
  A,
  B,
  newerDaemon,
  olderCommit,
  olderSuccessor,
  pendingOf,
  row,
  syncThen,
  worktree,
} from "./status-wait-successor-fixture.js";

/*
 * Review wave 13ad, B1 (task 001-268): an older daemon moves A's key from K
 * to K2 and back at the same revision, A still queued. The rows are as the
 * newer daemon's moves last named them, so no comparison of their values
 * can tell, while A's move is in no record. B has an open move of the
 * edit, and its result comes with the second commit. The wait never ends
 * quiet with A queued: another daemon registered, or wrote first.
 */

const K = "a-k";

describe("status --wait over an older daemon's key round trip (review wave 13ad, B1)", () => {
  it("never ends quiet when it runs between two reads, before refinement", async () => {
    const h = await newerDaemon(await worktree(3));
    h.commit([row(A, K, "queued"), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => {
        await olderSuccessor(h);
        olderCommit(h, [row(A, "a-k2", "queued")], [A]);
        olderCommit(h, [row(A, K, "queued"), row(B, "b-2", null)], [A], 4);
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("never ends quiet when it runs after the window was read", async () => {
    const h = await newerDaemon(await worktree(4));
    h.commit([row(A, K, "queued"), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => {
        await olderSuccessor(h);
        olderCommit(h, [row(A, "a-k2", "queued")], [A]);
        olderCommit(h, [row(A, K, "queued"), row(B, "b-2", null)], [A]);
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("holds for it when it ran before a newer daemon's first commit and the wait's sync", async () => {
    const w = await worktree(3);
    const first = await newerDaemon(w, 1);
    first.commit([row(A, K, "queued"), row(B, "b-2", "queued")], [B]);
    await olderSuccessor(first);
    olderCommit(w, [row(A, "a-k2", "queued")], [A]);
    olderCommit(w, [row(A, K, "queued")], [A], 4);
    const next = await newerDaemon(w, 3);
    next.commit([], [], true);
    const wait = await waitForStatus(w.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => next.commit([row(B, "b-2", null)])),
    });
    expect(pendingOf(w.store, w.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    // A was taken in as a move of revision 4: the wait holds for it by name.
    expect(wait).toMatchObject({ edit: { testFiles: 2, pending: 1 } });
  });

  // Control: the same round trip by the daemon that answered is in its moves, and held for.
  it("holds for it when the daemon that answered makes it", async () => {
    const h = await newerDaemon(await worktree(3));
    h.commit([row(A, K, "queued"), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => {
        h.commit([row(A, "a-k2", "queued")], [A]);
        h.commit([row(A, K, "queued"), row(B, "b-2", null)], [A]);
        h.store.meta.set(refinedMetaKey(h.id), "4");
      }),
    });
    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { testFiles: 2, pending: 1 } });
  });
});
