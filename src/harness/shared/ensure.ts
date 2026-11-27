import { randomUUID } from "node:crypto";
import { pinDaemon, requestDaemon } from "../../core/daemon/client.js";
import { ensureDaemon } from "../../core/daemon/ensure.js";
import { isNewerVersion, squealVersion } from "../../core/daemon/version.js";
import { otherSessionVersions } from "../../core/delivery/consumer-version.js";
import { stopHolds } from "../../core/delivery/stopped.js";
import { worktreeIdFor } from "../../core/fs/git-layout.js";
import { claimHandoff, spawnedAfterRest } from "../../core/presence/events.js";
import { spawnStartCurrent } from "../../core/presence/findings.js";
import { heartbeatFresh, lastHeartbeat } from "../../core/presence/heartbeat.js";
import { markSpawn } from "../../core/presence/lock-events.js";
import { readHookHandoff, readHookStop } from "../../core/presence/narrow.js";
import { handoffFrom, readHandoff, SUCCESSOR_LOCK_WAIT_MS } from "../../core/presence/stored.js";
import { lockFileFor } from "../../core/store/paths.js";
import { readTransaction } from "../../core/store/store.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../core/types/common.js";
import type { DaemonRequest, EnsureDaemonResult } from "../../core/types/daemon.js";
import type { Store } from "../../core/types/store.js";
import type { DaemonRecord, WorktreeRecord } from "../../core/types/store-records.js";
import type { HookContext, HookLocation } from "./context.js";
import type { HookDeps } from "./hook.js";

/** Spec 001 D9: "uses the socket only for liveness and nudges with a 100 ms timeout". */
export const SOCKET_TIMEOUT_MS = 100;

/**
 * What a hook's ensure did: `ensureDaemon`'s answer, or `stopped` when it
 * started nothing because `squeal stop` stopped the daemon and neither an
 * edit nor a start came since (task 011-08). `spawned` also when a daemon's
 * start was current and the hook spawned no second one (row 011-252): a
 * daemon is starting, which is what its callers read from it.
 */
export type HookEnsureResult = EnsureDaemonResult | "stopped";

/**
 * `ensureDaemon` with the hook's CLI (review wave 3, B1) and the socket
 * budget. With `context`, a held stopped mark starts nothing (`stopHolds`,
 * task 011-08); a daemon older than the hook is first asked to step down,
 * and when it accepts, the hook whose claim it is spawns its successor from
 * its own CLI, while one that finds the handoff claimed spawns nothing and
 * reads the daemon alive (`handOver`, row 011-32); a spawn after a rest
 * starts the rest's start timeout (`spawnedAfterRest`). Row 011-251 (F1):
 * every spawn writes the spawn mark (`markSpawn`), so a reader tells the
 * daemon's start before its lock from a stopped daemon.
 */
export async function ensure(
  location: HookLocation,
  deps: HookDeps,
  context?: HookContext,
  { stopRead = false }: { readonly stopRead?: boolean } = {},
): Promise<HookEnsureResult> {
  const worktree = context?.store.worktrees.get(context.consumer.worktreeId);
  const record = context === undefined ? undefined : (worktree?.daemon ?? null);
  if (context !== undefined && !stopRead && (await stopHeld(location, deps, context))) {
    return "stopped";
  }
  const handoff = context === undefined ? "none" : await handOver(context, deps);
  if (handoff === "claimed") return successor(location, deps);
  if (handoff === "joined") return "alive";
  const at = (deps.now ?? Date.now)();
  if (startCurrent(location, worktree, at)) return "spawned";
  const ensured = spawnMarked(
    location,
    { at, heartbeat: lastHeartbeat(worktree) },
    await (deps.ensureDaemon ?? ensureDaemon)(location.root, {
      socketTimeoutMs: SOCKET_TIMEOUT_MS,
      ...(deps.cli === undefined ? {} : { cli: deps.cli }),
      ...(record === undefined ? {} : { record }),
    }),
  );
  // Task 001-415: a rest is quiet only until the daemon spawned after it is due.
  if (ensured === "spawned" && context !== undefined) {
    await context.write(() => spawnedAfterRest(context.store, context.consumer.worktreeId, at));
  }
  return ensured;
}

/** Whether a `squeal stop` holds for the worktree of `context` (`stopHolds`, task 011-08). */
async function stopHeld(
  location: HookLocation,
  deps: HookDeps,
  context: HookContext,
): Promise<boolean> {
  const id = context.consumer.worktreeId;
  const worktree = context.store.worktrees.get(id);
  const stop = readHookStop(context.store, id, worktree ?? null, (deps.now ?? Date.now)());
  return stopHolds(context.store, { id, root: location.root }, stop, context.write);
}

/**
 * `ensured`, after a spawn at `at` wrote the worktree's spawn mark (row
 * 011-251), after the last heartbeat the store records, `null` unknown.
 */
function spawnMarked(
  location: HookLocation,
  spawn: { readonly at: EpochMs; readonly heartbeat: EpochMs | null },
  ensured: EnsureDaemonResult,
): EnsureDaemonResult {
  if (ensured === "spawned") markSpawn(lockFileOf(location), spawn.at, spawn.heartbeat);
  return ensured;
}

/**
 * Whether a daemon's start is current at `at` by the marks beside the lock
 * (`spawnStartCurrent`, row 011-252). Row 005-108: a new worktree has no row
 * until its daemon registers, so its lock is found by `location` then.
 */
function startCurrent(
  location: HookLocation,
  worktree: WorktreeRecord | null | undefined,
  at: EpochMs,
): boolean {
  const rowless = worktree === null || worktree === undefined ? lockFileOf(location) : undefined;
  return spawnStartCurrent(worktree, at, rowless);
}

/** The daemon lock file of the worktree at `location`. */
function lockFileOf(location: HookLocation): AbsolutePath {
  return lockFileFor(location.commonDir, worktreeIdFor(location.root));
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
  if (record === null || !heartbeatFresh(record, (deps.now ?? Date.now)())) {
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
 * takes no claim, and the hook ensures as before (`none`, row 011-434): it
 * says `claimed` only for a claim the store holds (`thrown`). Row 011-140: a daemon that registered
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
    const row = store.worktrees.get(id);
    const record = row?.daemon ?? null;
    if (row === null || record === null) return null;
    if (!succeeds(record, version, otherSessionVersions(store, consumer))) return null;
    const from = handoffFrom(record);
    const reading = readHookHandoff(store, id, row, from, at);
    return reading === null ? null : { record, from, ...reading };
  });
  if (read === null) return "none";
  if (read.joined) return "joined";
  if (read.alive) {
    if (!(await requestStepDown(read.record, version))) return "none";
  } else if (!read.stepping) {
    return "none";
  }
  // Row 011-434: this attempt's id in its claim, and what its transaction gave before any answer.
  const attempt = randomUUID();
  let ran: HandOver | null = null;
  try {
    // Spec 021 D15: with a daemon serving, under the worktree's write lease.
    return await context.write(() =>
      store.transaction(() => {
        const claim = stillRecorded(store, id, read.from)
          ? claimHandoff(store, id, { from: read.from, to: version, at: now(), attempt })
          : undefined;
        const result = claim === undefined ? "none" : claim === null ? "joined" : "claimed";
        ran = result;
        return result;
      }),
    );
  } catch {
    return thrown(ran, store, id, attempt);
  }
}

type HandOver = "none" | "joined" | "claimed";

/**
 * Row 011-434 (census G6): what a hook whose claim write threw says. It
 * said `claimed` for a claim the busy store never took, and `squeal start`,
 * finding none, claimed too: two successors waited for the lock. A
 * transaction that joined another's claim or found another daemon keeps
 * its answer: it wrote no claim. Otherwise the hook says `claimed` only
 * when the stored claim carries its `attempt` id, such as one the daemon
 * wrote before its answer was lost; never for another hook's claim of the
 * same time and version, after its own rolled back (review of 0.1.661). A
 * store that cannot be read counts as no claim of its own.
 */
function thrown(
  ran: HandOver | null,
  store: Store,
  worktreeId: WorktreeId,
  attempt: string,
): HandOver {
  if (ran === "joined" || ran === "none") return ran;
  try {
    return readHandoff(store, worktreeId)?.attempt === attempt ? "claimed" : "none";
  } catch {
    return "none";
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
 * Task 001-130: the hook that claimed the handoff (row 011-32) spawns its own
 * CLI's daemon at once, with a lock wait, so a current daemon follows without
 * another boundary, whichever plugin takes it.
 */
async function successor(location: HookLocation, deps: HookDeps): Promise<EnsureDaemonResult> {
  // The daemon it succeeds heartbeat until the step-down: this spawn is the first after it.
  const at = (deps.now ?? Date.now)();
  return spawnMarked(
    location,
    { at, heartbeat: at },
    await (deps.ensureDaemon ?? ensureDaemon)(location.root, {
      socketTimeoutMs: SOCKET_TIMEOUT_MS,
      awaitLockMs: SUCCESSOR_LOCK_WAIT_MS,
      ...(deps.cli === undefined ? {} : { cli: deps.cli }),
    }),
  );
}

/**
 * Whether a hook at `version` may succeed `record`'s daemon: it is newer,
 * and no other session's consumer runs an older version or none (review
 * wave 12b, B1). Lessons, defect 26: hooks at 0.1.31 talked to a 0.1.24
 * daemon for hours. An equal or newer daemon is left alone, so a downgrade
 * replaces nothing; a version that is not plain `major.minor.patch` on
 * either side compares as not newer. Review wave 12b, B1: a released older
 * hook taking the boundary after a step-down would start a daemon older
 * than the one that left. So nothing is asked while another session's
 * consumer registered with an older version, or with none (`others`, every
 * hook from before task 001-130): the daemon serves until those sessions
 * leave.
 */
export function succeeds(
  record: DaemonRecord,
  version: string,
  others: readonly (string | null)[],
): boolean {
  if (!isNewerVersion(version, record.squealVersion)) return false;
  return others.every((other) => other === version || isNewerVersion(other ?? "", version));
}

/**
 * `handOver`'s requests, once it asks a daemon this hook `succeeds` with a
 * fresh heartbeat. The daemon is asked over its socket to step down: it
 * cancels its tiers in flight, persists one note, clears its record and
 * exits (row 011-31, C9 as amended 2026-10-20). A daemon that accepts is
 * sent `stop` too, whatever it answers, so one from 0.1.200 on that steps
 * down without the cancel cancels on the stop. The hook then spawns its
 * successor (`successor`), which waits for the lock; a daemon spawned
 * meanwhile loses it and exits (D10). A daemon from before the request
 * answers "unknown request type" and is sent `stop`, which shuts down in
 * the same order. At most three round trips of the socket budget (the ping
 * of row 011-151, the request and its stop), only for an older daemon;
 * with its timers stopped a stepping daemon's heartbeat goes stale, so the
 * request is not repeated past two intervals. Row 011-151 (review
 * 0.1.277-r2, B1): every incarnation reuses the socket path, so a successor
 * that bound it after the decision would take a request sent by path, and
 * an older one knows no mark to refuse it by. The ping first proves the
 * file at the path is `record`'s daemon's (`pinDaemon`), and each request
 * after it is written only while that file is still there. True when the
 * daemon took a request to exit.
 */
export async function requestStepDown(record: DaemonRecord, version: string): Promise<boolean> {
  try {
    const pinned = await pinDaemon(record, SOCKET_TIMEOUT_MS);
    if (pinned === null) return false;
    const ask = (request: DaemonRequest) =>
      requestDaemon(record.socketPath, request, SOCKET_TIMEOUT_MS, pinned.endpoint);
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

/** What a session start registers with before it ensures the daemon (`registerFirst`). */
export interface StartFirst {
  /** `RegisterOptions.startingSince` of the registration that comes first. */
  readonly startingSince: EpochMs | undefined;
  /** The ensure after the registration: `ensure` with the stop already read. */
  readonly ensure: () => Promise<HookEnsureResult>;
}

/**
 * Row 005-98 (option A, the human 2026-11-17): a session start registers
 * first and ensures the daemon after, so the hook's 2 s timeout cannot kill
 * it between a spawn and its registration (`tasks/005-95/notes.md`). There is
 * no wait for the new daemon's heartbeat (0.1.538 waited up to 750 ms): unless a stop holds,
 * a daemon with no fresh heartbeat in the store is told as starting from
 * now, as after a settle that timed out (task 001-156). A daemon that then
 * answers without a heartbeat, or cannot be started, is told so once the
 * start's grace passed (`DAEMON_START_GRACE_MS`). A fresh heartbeat
 * registers as before: a handoff to a newer daemon happens in the ensure.
 */
export async function registerFirst(
  location: HookLocation,
  deps: HookDeps,
  context: HookContext,
): Promise<StartFirst> {
  const at = (deps.now ?? Date.now)();
  if (await stopHeld(location, deps, context)) {
    return { startingSince: undefined, ensure: async () => "stopped" };
  }
  const record = context.store.worktrees.get(context.consumer.worktreeId)?.daemon ?? null;
  return {
    startingSince: record !== null && heartbeatFresh(record, at) ? undefined : at,
    ensure: () => ensure(location, deps, context, { stopRead: true }),
  };
}

/** `RegisterOptions.startingSince` of a registration after a hook's `ensure` at `at` returned `ensured`. */
export function startingAfter(
  ensured: HookEnsureResult | "fresh",
  at: EpochMs,
): { readonly startingSince?: EpochMs } {
  return ensured === "spawned" ? { startingSince: at } : {};
}
