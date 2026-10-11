import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import {
  A,
  B,
  newerDaemon,
  pendingOf,
  row,
  syncThen,
  worktree,
} from "./status-wait-successor-fixture.js";

/*
 * Review wave 13ad, S1 (task 001-267): the daemon that answered the wait's
 * sync records a move of A at the captured revision after the wait read a
 * window of B alone, then B's result. The window takes A in, and the wait
 * does not end quiet with A queued.
 */

describe("status --wait over a move recorded after its window (review wave 13ad, S1)", () => {
  it("holds for a file whose move at the captured revision comes after the window", async () => {
    const h = await newerDaemon(await worktree(4));
    h.commit([row(A, "a-1", null), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_000,
      pollMs: 20,
      sync: syncThen(async () => {
        h.commit([row(A, "a-2", "queued")], [A]);
        h.commit([row(B, "b-2", null)]);
      }),
    });
    expect(pendingOf(h.store, h.id, A)).toBe("queued");
    expect(wait.outcome).toBe("timeout");
    expect(wait).toMatchObject({ edit: { testFiles: 2, pending: 1 } });
  });

  // Control: with no later move, B's result ends the wait on the window read first.
  it("ends quiet on the window's own files", async () => {
    const h = await newerDaemon(await worktree(4));
    h.commit([row(A, "a-1", null), row(B, "b-2", "queued")], [B]);
    const wait = await waitForStatus(h.repo.main, {
      timeoutMs: 1_000,
      pollMs: 20,
      sync: syncThen(async () => h.commit([row(B, "b-2", null)])),
    });
    expect(wait.outcome).toBe("quiet");
    expect(wait).toMatchObject({ edit: { testFiles: 1, pending: 0 } });
  });
});
