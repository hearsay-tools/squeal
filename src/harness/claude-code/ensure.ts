import { setTimeout as sleep } from "node:timers/promises";
import { ensureDaemon } from "../../core/daemon/ensure.js";
import { daemonLiveness } from "../../core/delivery/liveness.js";
import type { DaemonRecord, EnsureDaemonResult } from "../../core/types/index.js";
import type { HookContext, HookLocation } from "./context.js";
import type { HookDeps } from "./hook.js";

/** Spec 001 D9: "uses the socket only for liveness and nudges with a 100 ms timeout". */
export const SOCKET_TIMEOUT_MS = 100;

/**
 * How long SessionStart waits for the heartbeat of a daemon it just spawned
 * before it registers, so the registration does not report "no daemon" for a
 * daemon that answers 200 ms later. Within the 2 s hook timeout with Node
 * start, the probe and the registration.
 */
export const SPAWN_SETTLE_MS = 750;
const SETTLE_POLL_MS = 25;

/** `ensureDaemon` with the hook's CLI (review wave 3, B1) and the socket budget. */
export function ensure(
  location: HookLocation,
  deps: HookDeps,
  record?: DaemonRecord | null,
): Promise<EnsureDaemonResult> {
  return (deps.ensureDaemon ?? ensureDaemon)(location.root, {
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
    ...(deps.cli === undefined ? {} : { cli: deps.cli }),
    ...(record === undefined ? {} : { record }),
  });
}

/**
 * PostToolBatch and Stop (D9, review wave 3 S2): ensure the daemon when the
 * recorded heartbeat is older than two intervals. A store read while the
 * daemon lives; the socket only when it does not.
 */
export async function ensureIfStale(context: HookContext, deps: HookDeps): Promise<void> {
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  if (daemonLiveness(record, (deps.now ?? Date.now)()).state === "alive") return;
  await ensure(context, deps, record);
}

/**
 * Waits up to `SPAWN_SETTLE_MS` for a fresh heartbeat in the store. Not for
 * the daemon's start scan: attribution needs no wait (task 001-96, review
 * wave 10c S1).
 */
export async function settle(context: HookContext, deps: HookDeps): Promise<void> {
  const deadline = performance.now() + SPAWN_SETTLE_MS;
  const now = deps.now ?? Date.now;
  for (;;) {
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    if (daemonLiveness(record, now()).state === "alive") return;
    const left = deadline - performance.now();
    if (left <= 0) return;
    await sleep(Math.min(SETTLE_POLL_MS, left));
  }
}
