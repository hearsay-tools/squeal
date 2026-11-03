import type { AbsolutePath, DaemonResponse, Scheduler } from "../types/index.js";
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
