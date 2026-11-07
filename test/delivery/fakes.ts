import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import { bootstrappedMetaKey } from "../../src/core/types/daemon.js";
import type { StatusBuilder, StatusResult } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";

/**
 * A `StatusBuilder` that returns a fixed result, for delivery tests that do
 * not look at status. `test/status/builder.test.ts` covers the real one.
 */
export function fixedStatus(
  status: StatusResult = {
    schemaVersion: 1,
    available: false,
    reason: "timeout",
    message: "status unavailable: fake",
  },
): StatusBuilder {
  return { build: () => status };
}

/**
 * A live daemon in `worktreeId` that finished its start scan, so a
 * registration may be told "none of the files changed here" (task 001-96).
 * `scanned: false` leaves the bootstrap marker out.
 */
export function liveDaemon(
  store: Store,
  worktreeId: WorktreeId,
  { scanned = true, startedAt = 1 }: { scanned?: boolean; startedAt?: EpochMs } = {},
): void {
  if (store.worktrees.get(worktreeId) === null) {
    store.worktrees.upsert({
      id: worktreeId,
      root: `/repo/${worktreeId}`,
      commonDir: "/repo/.git",
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
  }
  store.worktrees.setDaemon(worktreeId, {
    socketPath: "/run/squeal.sock",
    startedAt,
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-test",
    token: "live",
  });
  if (scanned) store.meta.set(bootstrappedMetaKey(worktreeId), String(startedAt));
}
