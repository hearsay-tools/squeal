import { setTimeout as sleep } from "node:timers/promises";
import { requestDaemon } from "../../core/daemon/client.js";
import { ensureDaemon } from "../../core/daemon/ensure.js";
import { isNewerVersion, squealVersion } from "../../core/daemon/version.js";
import { otherSessionVersions } from "../../core/delivery/consumer-version.js";
import {
  claimHandoff,
  handoffFrom,
  liveHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
} from "../../core/delivery/handoff.js";
import {
  daemonLiveness,
  spawnedAfterRest,
  worktreeLiveness,
} from "../../core/delivery/liveness.js";
import { stopHolds } from "../../core/delivery/stopped.js";
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
 * What a hook's ensure did: `ensureDaemon`'s answer, or `stopped` when it
 * started nothing because `squeal stop` stopped the daemon and neither an
 * edit nor a start came since (task 011-08).
 */
export type HookEnsureResult = EnsureDaemonResult | "stopped";

/**
 * `ensureDaemon` with the hook's CLI (review wave 3, B1) and the socket
 * budget. With `context`, a held stopped mark starts nothing (`stopHolds`,
 * task 011-08); a daemon older than the hook is first asked to step down,
 * and when it accepts, the hook whose claim it is spawns its successor from
 * its own CLI, while one that finds the handoff claimed spawns nothing and
 * reads the daemon alive (`handOver`, row 011-32); a spawn after a rest
 * starts the rest's start timeout (`spawnedAfterRest`).
 */
export async function ensure(
  location: HookLocation,
  deps: HookDeps,
  context?: HookContext,
): Promise<HookEnsureResult> {
  const worktree = context?.store.worktrees.get(context.consumer.worktreeId);
  const record = context === undefined ? undefined : (worktree?.daemon ?? null);
  if (context !== undefined) {
    const live = worktreeLiveness(worktree ?? null, (deps.now ?? Date.now)());
    const at = { id: context.consumer.worktreeId, root: location.root };
    if (await stopHolds(context.store, at, worktree, live)) return "stopped";
  }
  const handoff = context === undefined ? "none" : await handOver(context, deps, record ?? null);
  if (handoff === "claimed") return successor(location, deps);
  if (handoff === "joined") return "alive";
  const at = (deps.now ?? Date.now)();
  const ensured = await (deps.ensureDaemon ?? ensureDaemon)(location.root, {
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
    ...(deps.cli === undefined ? {} : { cli: deps.cli }),
    ...(record === undefined ? {} : { record }),
  });
  // Task 001-415: a rest is quiet only until the daemon spawned after it is due.
  if (ensured === "spawned" && context !== undefined) {
    spawnedAfterRest(context.store, context.consumer.worktreeId, at);
  }
  return ensured;
}

/**
 * PostToolBatch and Stop (D9, review wave 3 S2): ensure the daemon when the
 * recorded heartbeat is older than two intervals. A store read while the
 * daemon lives; the socket only when it does not. `fresh` when the heartbeat
 * is; `unavailable` when no daemon validates and none was started: a daemon
 * that holds the lock and does not answer (SIGSTOPped, lessons defect 22), or
 * no CLI to spawn; `stopped` while `squeal stop` holds (task 011-08).
 */
export async function ensureIfStale(
  context: HookContext,
  deps: HookDeps,
): Promise<HookEnsureResult | "fresh"> {
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  if (daemonLiveness(record, (deps.now ?? Date.now)()).state !== "alive") {
    return ensure(context, deps, context);
  }
  if ((await handOver(context, deps, record)) === "claimed") await successor(context, deps);
  return "fresh";
}

/**
 * Row 011-32 (C9 as amended 2026-10-20): one successor per handoff. When
 * this hook would ask the daemon to step down (`asksStepDown`) and a live
 * claim names it (`liveHandoff`), it asks nothing: `joined`. Otherwise it
 * asks (`requestStepDown`), and on acceptance claims the handoff in one
 * write transaction: `claimed` when the claim is its own, `joined` when
 * another hook's came first. A store that stays busy past the hook's
 * timeout takes no claim, and the hook spawns as before (`claimed`): the
 * lock's winner serves and the rest exit. `none` when nothing was asked or
 * the daemon did not accept.
 */
async function handOver(
  context: HookContext,
  deps: HookDeps,
  record: DaemonRecord | null,
): Promise<"none" | "joined" | "claimed"> {
  const now = deps.now ?? Date.now;
  const version = deps.squealVersion ?? squealVersion();
  const others = otherSessionVersions(context.store, context.consumer);
  if (record === null || !asksStepDown(record, now(), version, others)) return "none";
  const id = context.consumer.worktreeId;
  const from = handoffFrom(record);
  if (liveHandoff(context.store, id, from, now()) !== null) return "joined";
  if (!(await requestStepDown(record, version))) return "none";
  try {
    const claim = claimHandoff(context.store, id, { from, to: version, at: now() });
    return claim === null ? "joined" : "claimed";
  } catch {
    return "claimed";
  }
}

/**
 * Task 001-130: the hook that claimed the handoff (row 011-32) spawns its own
 * CLI's daemon at once, with a lock wait, so a current daemon follows without
 * another boundary, whichever plugin takes it.
 */
function successor(location: HookLocation, deps: HookDeps): Promise<EnsureDaemonResult> {
  return (deps.ensureDaemon ?? ensureDaemon)(location.root, {
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
    awaitLockMs: SUCCESSOR_LOCK_WAIT_MS,
    ...(deps.cli === undefined ? {} : { cli: deps.cli }),
  });
}

/**
 * Lessons, defect 26: hooks at 0.1.31 talked to a 0.1.24 daemon for hours.
 * A daemon whose recorded version (`worktrees.daemon_version`) is strictly
 * older than this hook's, while its heartbeat is fresh, is asked over its
 * socket to step down: it cancels its tiers in flight, persists one note,
 * clears its record and exits (row 011-31, C9 as amended 2026-10-20). A
 * daemon that accepts is sent `stop` too, whatever it answers, so one from
 * 0.1.200 on that steps down without the cancel cancels on the stop. The
 * hook then spawns its successor (`successor`), which waits for the lock; a
 * daemon spawned meanwhile loses it and exits (D10). A daemon from before
 * the request answers "unknown request type" and is sent `stop`, which
 * shuts down in the same order. An
 * equal or newer daemon is left alone, so a downgrade replaces nothing; a
 * version that is not plain `major.minor.patch` on either side compares as
 * not newer.
 *
 * Review wave 12b, B1: a released older hook taking the boundary after a
 * step-down would start a daemon older than the one that left. So nothing is
 * asked while another session's consumer registered with an older version,
 * or with none (`others`, every hook from before task 001-130): the daemon
 * serves until those sessions leave. At most two round trips of the socket
 * budget, only for an older daemon; with its timers stopped a stepping
 * daemon's heartbeat goes stale, so the request is not repeated past two
 * intervals. True when the daemon took a request to exit.
 */
export async function stepDownIfOlder(
  record: DaemonRecord | null,
  now: EpochMs,
  version: string = squealVersion(),
  others: readonly (string | null)[] = [],
): Promise<boolean> {
  if (record === null || !asksStepDown(record, now, version, others)) return false;
  return requestStepDown(record, version);
}

/** Whether `stepDownIfOlder` asks `record`'s daemon to step down. */
function asksStepDown(
  record: DaemonRecord,
  now: EpochMs,
  version: string,
  others: readonly (string | null)[],
): boolean {
  if (!isNewerVersion(version, record.squealVersion)) return false;
  if (!others.every((other) => other === version || isNewerVersion(other ?? "", version))) {
    return false;
  }
  return daemonLiveness(record, now).state === "alive";
}

/** `stepDownIfOlder`'s requests, once it asks. */
async function requestStepDown(record: DaemonRecord, version: string): Promise<boolean> {
  try {
    const answer = await requestDaemon(
      record.socketPath,
      { type: "step-down", version },
      SOCKET_TIMEOUT_MS,
    );
    if (answer.ok) {
      if (answer.type !== "step-down" || !answer.steppingDown) return false;
      // Row 011-31: a daemon from 0.1.200 on that steps down without a cancel cancels on `stop`.
      await requestDaemon(record.socketPath, { type: "stop" }, SOCKET_TIMEOUT_MS).catch(() => null);
      return true;
    }
    if (!answer.error.startsWith("unknown request type")) return false;
    return (await requestDaemon(record.socketPath, { type: "stop" }, SOCKET_TIMEOUT_MS)).ok;
  } catch {
    return false;
  }
}

/**
 * Waits up to `SPAWN_SETTLE_MS` for a fresh heartbeat in the store. Not for
 * the daemon's start scan: attribution needs no wait (task 001-96, review
 * wave 10c S1). True when it came.
 */
export async function settle(context: HookContext, deps: HookDeps): Promise<boolean> {
  const deadline = performance.now() + SPAWN_SETTLE_MS;
  const now = deps.now ?? Date.now;
  for (;;) {
    const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
    if (daemonLiveness(record, now()).state === "alive") return true;
    const left = deadline - performance.now();
    if (left <= 0) return false;
    await sleep(Math.min(SETTLE_POLL_MS, left));
  }
}

/**
 * `ensure` before a registration (SessionStart, a registering
 * UserPromptSubmit), then `settle` after a spawn. Task 001-156: on a loaded
 * host the spawned daemon's first heartbeat can come after the settle (1.5 s
 * at load 127); the time of the spawn then, as `RegisterOptions.startingSince`,
 * so the registration says a daemon is starting; `undefined` otherwise.
 */
export async function ensureToRegister(
  location: HookLocation,
  deps: HookDeps,
  context: HookContext,
): Promise<EpochMs | undefined> {
  const at = (deps.now ?? Date.now)();
  if ((await ensure(location, deps, context)) !== "spawned") return undefined;
  return (await settle(context, deps)) ? undefined : at;
}

/** `RegisterOptions.startingSince` of a registration after a hook's `ensure` at `at` returned `ensured`. */
export function startingAfter(
  ensured: HookEnsureResult | "fresh",
  at: EpochMs,
): { readonly startingSince?: EpochMs } {
  return ensured === "spawned" ? { startingSince: at } : {};
}
