import {
  bootstrappedMetaKey,
  type EpochMs,
  type StatusBuilder,
  type StatusResult,
  type Store,
  type WorktreeId,
} from "../../src/core/types/index.js";

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
 * A live daemon in `worktreeId` that finished its start scan (task 001-94,
 * review wave 10b B2), so a registration records where the consumer's
 * changes start. `scanned: false` leaves the bootstrap marker out.
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
  });
  if (scanned) store.meta.set(bootstrappedMetaKey(worktreeId), String(startedAt));
}
