import { randomUUID } from "node:crypto";
import {
  type AbsolutePath,
  type DaemonResponse,
  PAYLOAD_SCHEMA_VERSION,
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

/** How long `requestGroupRun` waits for the daemon's first answer by default: the CLI's socket budget. */
export const GROUP_REQUEST_MS = 2_000;

/**
 * Hands `squeal run <group>` to the scheduler's `requestGroup` (spec 019
 * D6): `null` for a group the policy in force does not have. A scheduler
 * without the method rejects with `GROUP_NOT_SUPPORTED`.
 */
export function requestGroup(
  scheduler: Scheduler,
  group: string,
): Promise<SlowSuiteRequested | null> {
  const groups = scheduler as Partial<Pick<Scheduler, "requestGroup">>;
  if (typeof groups.requestGroup !== "function") {
    return Promise.reject(new Error(GROUP_NOT_SUPPORTED));
  }
  return groups.requestGroup.call(scheduler, group);
}

/** One `run-group` request as the socket remembers it for `run-group-status`. */
interface GroupRequest {
  readonly group: string;
  requested: SlowSuiteRequested | null;
  unknown: boolean;
  error: string | null;
}

/**
 * The `run-group` requests of one socket (spec 019 D6). `start` hands the
 * group to `requestGroup`, never awaited, and answers at once with the
 * request's id; `status` answers what the scheduler did with it, `null` for
 * an id it does not remember. The newest `max` are remembered. Without
 * `requestGroup`, each request fails with `GROUP_NOT_SUPPORTED`.
 */
export function groupRequests(
  requestGroup: ((group: string) => Promise<SlowSuiteRequested | null>) | undefined,
  max: number,
): {
  start(group: string): RunGroupResponse;
  status(requestId: string): RunGroupResponse | null;
} {
  const requests = new Map<string, GroupRequest>();
  const answer = (requestId: string, request: GroupRequest): RunGroupResponse => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-group",
    requestId,
    group: request.group,
    requested: request.requested,
    unknown: request.unknown,
    error: request.error,
  });
  return {
    start(group) {
      const requestId = randomUUID();
      const request: GroupRequest = { group, requested: null, unknown: false, error: null };
      requests.set(requestId, request);
      for (const old of requests.keys()) {
        if (requests.size <= max) break;
        requests.delete(old);
      }
      (requestGroup?.(group) ?? Promise.reject(new Error(GROUP_NOT_SUPPORTED))).then(
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
