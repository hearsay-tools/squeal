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
 * Review wave 13ac, B1 (task 001-265): a newer daemon answers the wait's
 * sync, then a daemon before task 001-258 succeeds it and moves a key of
 * the captured edit without writing the store's re-key moves. Its moves
 * are its own, so the wait never ends quiet on them.
 */

describe("status --wait after an older daemon succeeds the one that synced (review wave 13ac, B1)", () => {
  it("never ends quiet when the successor refines the capture with a key it did not record", async () => {
    // A had its pass at revision 3; the runner part of revision 4 finds its new key.
    const h = await newerDaemon(await worktree(3));
    h.commit([row(A, "a-1", null)]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      sync: syncThen(async () => {
        await olderSuccessor(h);
        olderCommit(h, [row(A, "a-2", "queued")], [A], 4);
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  it("never ends quiet when the successor moves a key after the window was read", async () => {
    // The newer daemon refined revision 4: the window holds for B, whose key it moved.
    const h = await newerDaemon(await worktree(4));
    h.commit([row(A, "a-1", null), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_500,
      pollMs: 20,
      // B has its result; A's environment grew at the same revision.
      sync: syncThen(async () => {
        await olderSuccessor(h);
        olderCommit(h, [row(B, "b-2", null), row(A, "a-2", "queued")], [A]);
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });

  // Control: the same commits by a ledger that records its moves hold the wait for A by name.
  it("holds for the key when the successor records its moves", async () => {
    const h = await newerDaemon(await worktree(3));
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
