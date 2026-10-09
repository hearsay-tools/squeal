import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { SyncState } from "../../src/cli/status-sync.js";
import { STATUS_WAIT_SETTLE_MS, waitForStatus } from "../../src/cli/status-wait.js";
import { LOADED } from "../daemon/helpers.js";
import { settled, waitDaemons } from "./wait-daemon.js";

/*
 * Lessons, defect 30, under a real daemon run from the sources: on cezar at
 * load 95 to 120, 15 of 18 waits started right after an edit returned
 * "nothing pending at revision N-1", since the edit's revision committed up
 * to 3.1 s after the edit. Here a second connection holds the store's write
 * lock 3 s from just before the edit, so the daemon cannot store the edit's
 * revision until then, and a wait started right after the edit must not end
 * quiet at the revision before it.
 */

const { createRepo, startDaemon } = waitDaemons("wait-sync");
const SLOW = { timeout: 600_000 } as const;
const HOLD_MS = 3_000;

/** Takes the store's write lock from a connection of its own, and gives it back after `ms`. */
function holdWriteLock(root: string, ms: number): Promise<void> {
  const db = new DatabaseSync(join(root, ".git/squeal/store.sqlite"));
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("BEGIN IMMEDIATE");
  return new Promise((done) =>
    setTimeout(() => {
      db.exec("COMMIT");
      db.close();
      done();
    }, ms),
  );
}

/** A daemon from before the `sync` request, as the wait sees it. */
const cannotSync = () => ({
  current: (): SyncState => ({ state: "unsupported" }),
  stop: () => {},
});

describe("status --wait right after an edit whose revision commits late (defect 30)", () => {
  it("never ends quiet at the revision before the edit", SLOW, async () => {
    const root = createRepo("synced");
    await startDaemon(root);
    const before = (await settled(root)).revision;

    const released = holdWriteLock(root, HOLD_MS);
    appendFileSync(join(root, "src/mod.ts"), "// touched\n");
    const wait = await waitForStatus(root, { timeoutMs: 120_000 });
    await released;

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ revision: before + 1 });
    expect(wait.waitedMs).toBeGreaterThanOrEqual(HOLD_MS - 100);
  });

  it("returns promptly when nothing was edited", SLOW, async () => {
    const root = createRepo("idle");
    await startDaemon(root);
    const before = (await settled(root)).revision;

    const wait = await waitForStatus(root, { timeoutMs: 120_000 });

    expect(wait.outcome).toBe("quiet");
    expect(wait.result).toMatchObject({ revision: before });
    if (!LOADED) expect(wait.waitedMs).toBeLessThan(2 * STATUS_WAIT_SETTLE_MS);
  });

  it(
    "without a sync, the held revision reads as quiet at the earlier one (the defect)",
    SLOW,
    async () => {
      const root = createRepo("unsynced");
      await startDaemon(root);
      const before = (await settled(root)).revision;

      const released = holdWriteLock(root, HOLD_MS);
      appendFileSync(join(root, "src/mod.ts"), "// touched\n");
      const wait = await waitForStatus(root, { timeoutMs: 120_000, sync: cannotSync });
      await released;

      expect(wait.outcome).toBe("quiet");
      expect(wait.result).toMatchObject({ revision: before });
    },
  );
});
