import { setTimeout as sleep } from "node:timers/promises";
import { pinDaemon, requestDaemon } from "../../core/daemon/client.js";
import { ensureDaemon } from "../../core/daemon/ensure.js";
import { isNewerVersion, squealVersion } from "../../core/daemon/version.js";
import { otherSessionVersions } from "../../core/delivery/consumer-version.js";
import {
  claimHandoff,
  handoffFrom,
  liveHandoff,
  readHandoff,
  readShortHandoff,
  SUCCESSOR_LOCK_WAIT_MS,
} from "../../core/delivery/handoff.js";
import {
  daemonLiveness,
  spawnedAfterRest,
  worktreeLiveness,
} from "../../core/delivery/liveness.js";
import { stopHolds } from "../../core/delivery/stopped.js";
import { shutDown } from "../../core/status/died.js";
import { readTransaction } from "../../core/store/index.js";
import {
  type DaemonRecord,
  type DaemonRequest,
  daemonIncarnation,
  type EnsureDaemonResult,
  type EpochMs,
  type Store,
  type WorktreeId,
} from "../../core/types/index.js";
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
  const handoff = context === undefined ? "none" : await handOver(context, deps);
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
  if ((await handOver(context, deps)) === "claimed") await successor(context, deps);
  return "fresh";
}

/**
 * Row 011-32 (C9 as amended 2026-10-20): one successor per handoff. When
 * this hook may succeed the daemon (`succeeds`) and a live claim names it
 * (`liveHandoff`), it asks nothing: `joined`. Otherwise, with the heartbeat
 * fresh, it asks (`requestStepDown`), and on acceptance claims the handoff
 * in one write transaction: `claimed` when the claim is its own, `joined`
 * when another hook's came first. With the heartbeat stopped, which a
 * stepping daemon's is long before the claim's bound, it asks nothing and
 * claims only when the daemon already steps down (`steppingDown`), so the
 * next boundary after the bound or a timed-out lock wait spawns again
 * (review 0.1.259, B1). A store that stays busy past the hook's timeout
 * takes no claim, and the hook spawns as before (`claimed`): the lock's
 * winner serves and the rest exit. Row 011-140: a daemon that registered
 * older than the claim it ended (`readShortHandoff`) is asked nothing again;
 * `squeal start` replaces it. Review 0.1.277, B1: the record, the claim and
 * the mark are read in one read transaction, as the successor writes them in
 * one, so a short successor that registers meanwhile is read with its mark,
 * not as the daemon it succeeded at the socket it reuses. Row 011-151: the
 * requests reach that daemon or nothing (`requestStepDown`), and the claim
 * is taken only while the store still records it or none
 * (`stillRecorded`). `none` when nothing was asked, the daemon did not
 * accept, or another registered since.
 */
async function handOver(
  context: HookContext,
  deps: HookDeps,
): Promise<"none" | "joined" | "claimed"> {
  const now = deps.now ?? Date.now;
  const version = deps.squealVersion ?? squealVersion();
  const { store, consumer } = context;
  const id = consumer.worktreeId;
  const at = now();
  const read = readTransaction(store, () => {
    const record = store.worktrees.get(id)?.daemon ?? null;
    if (record === null || !succeeds(record, version, otherSessionVersions(store, consumer))) {
      return null;
    }
    const from = handoffFrom(record);
    if (readShortHandoff(store, id)?.of === from) return null;
    const alive = daemonLiveness(record, at).state === "alive";
    return {
      record,
      from,
      alive,
      joined: liveHandoff(store, id, from, at) !== null,
      stepping: !alive && steppingDown(store, id, record),
    };
  });
  if (read === null) return "none";
  if (read.joined) return "joined";
  if (read.alive) {
    if (!(await requestStepDown(read.record, version))) return "none";
  } else if (!read.stepping) {
    return "none";
  }
  try {
    const claim = store.transaction(() => {
      if (!stillRecorded(store, id, read.from)) return undefined;
      return claimHandoff(store, id, { from: read.from, to: version, at: now() });
    });
    if (claim === undefined) return "none";
    return claim === null ? "joined" : "claimed";
  } catch {
    return "claimed";
  }
}

/**
 * Row 011-151: whether the store still records the daemon `from` names, or
 * none since it cleared its record. Another one registered after the
 * decision ended that daemon's handoff: no claim from it, and no successor.
 */
function stillRecorded(store: Store, worktreeId: WorktreeId, from: string): boolean {
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  return record === null || handoffFrom(record) === from;
}

/**
 * Whether `record`'s daemon took a step-down already: its shutdown began
 * (`shutDown`, every release from 0.1.121), or a claim names it, past its
 * bound now, which only an accepted step-down writes.
 */
function steppingDown(store: Store, worktreeId: WorktreeId, record: DaemonRecord): boolean {
  const self = daemonIncarnation(record);
  if (self !== null && shutDown(store, worktreeId, self)) return true;
  return readHandoff(store, worktreeId)?.from === handoffFrom(record);
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
 * serves until those sessions leave. At most three round trips of the socket
 * budget (the ping of row 011-151, the request and its stop), only for an
 * older daemon; with its timers stopped a stepping
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
  return succeeds(record, version, others) && daemonLiveness(record, now).state === "alive";
}

/**
 * Whether a hook at `version` may succeed `record`'s daemon: it is newer,
 * and no other session's consumer runs an older version or none (review
 * wave 12b, B1).
 */
function succeeds(
  record: DaemonRecord,
  version: string,
  others: readonly (string | null)[],
): boolean {
  if (!isNewerVersion(version, record.squealVersion)) return false;
  return others.every((other) => other === version || isNewerVersion(other ?? "", version));
}

/**
 * `stepDownIfOlder`'s requests, once it asks. Row 011-151 (review
 * 0.1.277-r2, B1): every incarnation reuses the socket path, so a successor
 * that bound it after the decision would take a request sent by path, and
 * an older one knows no mark to refuse it by. The ping first proves the
 * file at the path is `record`'s daemon's (`pinDaemon`), and each request
 * after it is written only while that file is still there.
 */
async function requestStepDown(record: DaemonRecord, version: string): Promise<boolean> {
  try {
    const endpoint = await pinDaemon(record, SOCKET_TIMEOUT_MS);
    if (endpoint === null) return false;
    const ask = (request: DaemonRequest) =>
      requestDaemon(record.socketPath, request, SOCKET_TIMEOUT_MS, endpoint);
    const answer = await ask({ type: "step-down", version });
    if (answer.ok) {
      if (answer.type !== "step-down" || !answer.steppingDown) return false;
      // Row 011-31: a daemon from 0.1.200 on that steps down without a cancel cancels on `stop`.
      await ask({ type: "stop" }).catch(() => null);
      return true;
    }
    if (!answer.error.startsWith("unknown request type")) return false;
    return (await ask({ type: "stop" })).ok;
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
