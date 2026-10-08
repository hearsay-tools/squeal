import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../../core/daemon/client.js";
import { ensureDaemon } from "../../core/daemon/ensure.js";
import { isNewerVersion, squealVersion } from "../../core/daemon/version.js";
import { daemonLiveness } from "../../core/delivery/liveness.js";
import type { DaemonRecord, EnsureDaemonResult, EpochMs } from "../../core/types/index.js";
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

/**
 * `ensureDaemon` with the hook's CLI (review wave 3, B1) and the socket
 * budget, after a daemon older than the hook was asked to step down.
 */
export async function ensure(
  location: HookLocation,
  deps: HookDeps,
  record?: DaemonRecord | null,
): Promise<EnsureDaemonResult> {
  if (record !== undefined) await stepDownIfOlder(record, (deps.now ?? Date.now)());
  return (deps.ensureDaemon ?? ensureDaemon)(location.root, {
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
    ...(deps.cli === undefined ? {} : { cli: deps.cli }),
    ...(record === undefined ? {} : { record }),
  });
}

/**
 * PostToolBatch and Stop (D9, review wave 3 S2): ensure the daemon when the
 * recorded heartbeat is older than two intervals. A store read while the
 * daemon lives; the socket only when it does not. `fresh` when the heartbeat
 * is; `unavailable` when no daemon validates and none was started: a daemon
 * that holds the lock and does not answer (SIGSTOPped, lessons defect 22), or
 * no CLI to spawn.
 */
export async function ensureIfStale(
  context: HookContext,
  deps: HookDeps,
): Promise<EnsureDaemonResult | "fresh"> {
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  const now = (deps.now ?? Date.now)();
  if (daemonLiveness(record, now).state !== "alive") return ensure(context, deps, record);
  await stepDownIfOlder(record, now);
  return "fresh";
}

/**
 * Lessons, defect 26: hooks at 0.1.31 talked to a 0.1.24 daemon for hours.
 * A daemon whose recorded version (`worktrees.daemon_version`) is strictly
 * older than this hook's, while its heartbeat is fresh, is asked over its
 * socket to step down: it lets a tier in flight finish and store, persists
 * one note, clears its record and exits, and the next hook boundary finds
 * no daemon and spawns one from its own CLI. Until then the old daemon
 * holds the lock, so a daemon spawned meanwhile loses it and exits (D10).
 * A daemon from before the request answers "unknown request type" and is
 * sent `stop`, which shuts down in the same order. An equal or newer daemon
 * is left alone, so a downgrade replaces nothing; a version that is not
 * plain `major.minor.patch` on either side compares as not newer. At most
 * two round trips of the socket budget, only for an older daemon; with its
 * timers stopped a stepping daemon's heartbeat goes stale, so the request
 * is not repeated past two intervals. True when the daemon took a request.
 */
export async function stepDownIfOlder(
  record: DaemonRecord | null,
  now: EpochMs,
  version: string = squealVersion(),
): Promise<boolean> {
  if (record === null || !isNewerVersion(version, record.squealVersion)) return false;
  if (daemonLiveness(record, now).state !== "alive") return false;
  try {
    const answer = await requestDaemon(
      record.socketPath,
      { type: "step-down", version },
      SOCKET_TIMEOUT_MS,
    );
    if (answer.ok) return true;
    if (!answer.error.startsWith("unknown request type")) return false;
    return (await requestDaemon(record.socketPath, { type: "stop" }, SOCKET_TIMEOUT_MS)).ok;
  } catch {
    return false;
  }
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
