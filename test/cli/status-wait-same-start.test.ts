import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
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
 * Review wave 13ae (task 001-270): after the wait read a window of B, an
 * older daemon moves A's key and back and records B's result, then a newer
 * one registers at the start time and version of the one that answered (a
 * clock set back). Between two of the wait's reads only the last
 * registration shows; its start token is not the answering daemon's, so
 * the wait falls back and never ends quiet with A queued.
 */

describe("status --wait over a successor registered at the same start time (review wave 13ae)", () => {
  it("never ends quiet when the successor's version and start time are the answering daemon's", async () => {
    const h = await newerDaemon(await worktree(4));
    h.commit([row(A, "a-k", "queued"), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_000,
      pollMs: 20,
      sync: syncThen(async () => {
        await olderSuccessor(h);
        // From here to the registration no read runs: nothing in between yields to a timer.
        olderCommit(h, [row(A, "a-k2", "queued")], [A]);
        olderCommit(h, [row(A, "a-k", "queued"), row(B, "b-2", null)], [A], 4);
        h.store.worktrees.setDaemon(h.id, { ...h.record, token: randomUUID() });
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).not.toHaveProperty("edit");
  });
});
