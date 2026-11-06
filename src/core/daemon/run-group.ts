import { randomUUID } from "node:crypto";
import {
  type AbsolutePath,
  type DaemonResponse,
  type EpochMs,
  type GroupHolder,
  type NarrowRun,
  PAYLOAD_SCHEMA_VERSION,
  type RelativePath,
  type RunGroupResponse,
  type Scheduler,
} from "../types/index.js";
import { requestDaemon } from "./client.js";
import type { SlowSuiteRequested } from "./run-slow.js";

/**
 * Message of a `run-group` on a daemon whose scheduler has no
 * `requestGroup`, and the CLI's words for a daemon that answers the request
 * unknown: one from before check groups (spec 019 D6).
 */
export const GROUP_NOT_SUPPORTED =
  "squeal run <group> is not supported by this daemon, which predates check groups; `squeal stop`, then `squeal start`, starts the installed version";

/**
 * Row 019-49: message of a `run-group-paths` on a daemon whose scheduler has
 * no `requestGroupPaths`, and the CLI's words for a daemon that answers the
 * request unknown: one from before narrow runs. Neither ran anything.
 */
export const NARROW_NOT_SUPPORTED =
  "squeal run <group> <path>... is not supported by this daemon, which predates narrow runs, and it ran nothing; `squeal stop`, then `squeal start`, starts the installed version";

/** What a group request queued; for a narrow run (row 019-49), what its paths selected. */
export type GroupRequested = SlowSuiteRequested & { readonly narrow?: NarrowRun };

/** How long `requestGroupRun` waits for the daemon's first answer by default: the CLI's socket budget. */
export const GROUP_REQUEST_MS = 2_000;

/**
 * What holds a `run-group` request on the daemon's main thread (row
 * 011-302), from when (epoch ms): the socket's answer turns `since` into
 * `GroupHolder.heldMs`. `null`: nothing recorded holds it.
 */
export type HeldBy =
  | { readonly kind: "startup"; readonly since: EpochMs }
  | { readonly kind: "scheduler"; readonly operation: string | null; readonly since: EpochMs }
  | null;

/** The main thread tells the socket what holds a request, each time it changes (row 011-302). */
export type Held = (holder: HeldBy) => void;

/**
 * A step of the daemon's main thread that may block it, which the socket
 * names while it runs (row 011-302): lint keying.
 */
export interface MainStep {
  readonly operation: string;
  readonly since: EpochMs;
}

/**
 * The words for a lint pass's keying of `tool`'s checks, the one step the
 * main thread tells the socket of (row 011-302). In gh-154 a request waited
 * through a main-thread stall of at least 111 s during lint re-keying; the
 * function that stalled is not known.
 */
export function keyingStep(tool: string): string {
  return tool === "eslint" ? "keying lint checks" : `keying ${tool} lint checks`;
}

/**
 * The steps the main thread said it runs, as the socket keeps them (row
 * 011-302): `set` at a step's start with its time, at its end with `null`;
 * `current` is the oldest still running, `null` when none runs.
 */
export class MainSteps {
  readonly #running = new Map<string, EpochMs>();

  set(operation: string, since: EpochMs | null): void {
    if (since === null) this.#running.delete(operation);
    else this.#running.set(operation, since);
  }

  current(): MainStep | null {
    let oldest: MainStep | null = null;
    for (const [operation, since] of this.#running) {
      if (oldest === null || since < oldest.since) oldest = { operation, since };
    }
    return oldest;
  }
}

/**
 * Hands `squeal run <group>` to the scheduler's `requestGroup` (spec 019
 * D6): `null` for a group the policy in force does not have. A scheduler
 * without the method rejects with `GROUP_NOT_SUPPORTED`. Row 011-302: while
 * the request waits for the scheduler's lock, `held` hears each holder of
 * it; the watch ends once the scheduler took the request or failed it, so
 * the lock's turnover costs nothing when no request waits. A scheduler
 * without `watchLock` names no holder.
 */
export async function requestGroup(
  scheduler: Scheduler,
  group: string,
  held?: Held,
  paths?: readonly RelativePath[],
): Promise<GroupRequested | null> {
  const groups = scheduler as Partial<Pick<Scheduler, "requestGroup" | "requestGroupPaths">>;
  if (typeof groups.requestGroup !== "function") throw new Error(GROUP_NOT_SUPPORTED);
  // Row 019-49: a scheduler before narrow runs runs none, never the whole group.
  if (paths !== undefined && typeof groups.requestGroupPaths !== "function") {
    throw new Error(NARROW_NOT_SUPPORTED);
  }
  const stop =
    held === undefined
      ? undefined
      : scheduler.watchLock?.((holder) =>
          held(holder === null ? null : { kind: "scheduler", ...holder }),
        );
  if (stop === undefined) held?.(null);
  try {
    if (paths !== undefined) return (await scheduler.requestGroupPaths?.(group, paths)) ?? null;
    return await groups.requestGroup.call(scheduler, group);
  } finally {
    stop?.();
  }
}

/** One `run-group` request as the socket remembers it for `run-group-status`. */
interface GroupRequest {
  readonly group: string;
  /** When the socket handed it to the main thread. */
  readonly at: EpochMs;
  requested: GroupRequested | null;
  unknown: boolean;
  error: string | null;
  /** What the main thread last said holds it; `undefined` until it read the request. */
  held: HeldBy | undefined;
}

/**
 * The `run-group` requests of one socket (spec 019 D6). `start` hands the
 * group to `requestGroup`, never awaited, and answers at once with the
 * request's id; `status` answers what the scheduler did with it, `null` for
 * an id it does not remember. The newest `max` are remembered. Without
 * `requestGroup`, each request fails with `GROUP_NOT_SUPPORTED`.
 *
 * Row 011-302: until the scheduler took a request, each answer says what
 * holds it (`GroupHolder`): what the main thread last told `held`, or that
 * it has not read the request yet; and `step()`, the main thread's step
 * that may block it, when one runs.
 */
export function groupRequests(
  requestGroup:
    | ((
        group: string,
        held: Held,
        paths?: readonly RelativePath[],
      ) => Promise<GroupRequested | null>)
    | undefined,
  max: number,
  step: () => MainStep | null = () => null,
  now: () => EpochMs = Date.now,
): {
  start(group: string, paths?: readonly RelativePath[]): RunGroupResponse;
  status(requestId: string): RunGroupResponse | null;
} {
  const requests = new Map<string, GroupRequest>();
  const holderOf = (request: GroupRequest): GroupHolder | null => {
    const { held } = request;
    if (request.requested !== null || request.unknown || request.error !== null) return null;
    const at = now();
    const since = (from: EpochMs) => Math.max(0, at - from);
    const running = step();
    const stepped = {
      step:
        running === null ? null : { operation: running.operation, heldMs: since(running.since) },
    };
    if (held === undefined) return { kind: "unanswered", heldMs: since(request.at), ...stepped };
    if (held === null) return { kind: "unknown", ...stepped };
    if (held.kind === "startup") return { kind: "startup", heldMs: since(held.since), ...stepped };
    const { operation } = held;
    return { kind: "scheduler", operation, heldMs: since(held.since), ...stepped };
  };
  const answer = (requestId: string, request: GroupRequest): RunGroupResponse => {
    const { requested } = request;
    return {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      ok: true,
      type: "run-group",
      requestId,
      group: request.group,
      requested:
        requested === null ? null : { revision: requested.revision, queued: requested.queued },
      unknown: request.unknown,
      error: request.error,
      holder: holderOf(request),
      ...(requested?.narrow === undefined ? {} : { narrow: requested.narrow }),
    };
  };
  return {
    start(group, paths) {
      const requestId = randomUUID();
      const request: GroupRequest = {
        group,
        at: now(),
        requested: null,
        unknown: false,
        error: null,
        held: undefined,
      };
      requests.set(requestId, request);
      for (const old of requests.keys()) {
        if (requests.size <= max) break;
        requests.delete(old);
      }
      const held: Held = (holder) => {
        request.held = holder;
      };
      const missing = new Error(paths === undefined ? GROUP_NOT_SUPPORTED : NARROW_NOT_SUPPORTED);
      (requestGroup?.(group, held, paths) ?? Promise.reject(missing)).then(
        (requested) => {
          if (requested === null) request.unknown = true;
          else request.requested = requested;
        },
        (error: unknown) => {
          request.error = error instanceof Error ? error.message : String(error);
        },
      );
      return answer(requestId, request);
    },
    status(requestId) {
      const request = requests.get(requestId);
      return request === undefined ? null : answer(requestId, request);
    },
  };
}

/**
 * Sends `run-group` for `group` to the daemon on `socketPath`, as `squeal
 * run <group>` does, and returns its first answer: a request id to poll with
 * `run-group-status`, or an error answer (an older daemon's "unknown request
 * type"). `null` when no daemon answered within `timeoutMs`. Never rejects.
 * Stop's waiting entry sends it for a configured group it requires (row
 * 019-14); the default `slow` group keeps `run-slow`.
 */
export async function requestGroupRun(
  socketPath: AbsolutePath,
  group: string,
  timeoutMs: number = GROUP_REQUEST_MS,
): Promise<DaemonResponse | null> {
  try {
    return await requestDaemon(socketPath, { type: "run-group", group }, timeoutMs);
  } catch {
    return null;
  }
}
