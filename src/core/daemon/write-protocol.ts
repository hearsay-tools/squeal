import type { WorktreeId } from "../types/common.js";
import type {
  LeaseProcess,
  LeaseRequest,
  ReleaseRequest,
  WriteRequest,
  WriteStatusRequest,
} from "../types/daemon-writes.js";
import { parseBatch } from "./write-batch.js";

export type WriteRequests = LeaseRequest | ReleaseRequest | WriteRequest | WriteStatusRequest;

const TYPES = new Set(["lease", "release", "write", "write-status"]);

/** Whether `request` is one of the requests that send writes. */
export function isWriteRequest(request: { readonly type: string }): request is WriteRequests {
  return TYPES.has(request.type);
}

/**
 * Spec 021 D15 (row 021-16): the requests that send writes, parsed;
 * a string says why one is not a request, `undefined` that it is none of them.
 */
export function parseWriteRequest(
  request: Record<string, unknown>,
): WriteRequests | string | undefined {
  switch (request.type) {
    case "lease": {
      if (!isText(request.worktreeId)) return '"worktreeId" must be a non-empty string';
      if (typeof request.holder !== "string") return '"holder" must be a string';
      const process = parseProcess(request.process);
      if (typeof process === "string") return process;
      return {
        type: "lease",
        worktreeId: request.worktreeId as WorktreeId,
        holder: request.holder,
        ...(process === null ? {} : { process }),
      };
    }
    case "release":
      if (!isText(request.worktreeId)) return '"worktreeId" must be a non-empty string';
      if (!isText(request.token)) return '"token" must be a non-empty string';
      return {
        type: "release",
        worktreeId: request.worktreeId as WorktreeId,
        token: request.token,
      };
    case "write":
      return parseWrite(request);
    case "write-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "write-status", requestId: request.requestId };
    default:
      return undefined;
  }
}

/** A batch the daemon writes, every statement checked (`parseBatch`). */
function parseWrite(request: Record<string, unknown>): WriteRequest | string {
  const { worktreeId, storeSchema, token, release } = request;
  if (!isText(worktreeId)) return '"worktreeId" must be a non-empty string';
  if (!Number.isInteger(storeSchema)) return '"storeSchema" must be an integer';
  if (token !== null && !isText(token)) return '"token" must be a non-empty string or null';
  if (typeof release !== "boolean") return '"release" must be true or false';
  const batch = parseBatch(request.batch);
  if (typeof batch === "string") return batch;
  return {
    type: "write",
    worktreeId: worktreeId as WorktreeId,
    storeSchema: storeSchema as number,
    token,
    release,
    batch,
  };
}

/** A lease's process (review 0.1.442 B3); `null` when the request names none. */
function parseProcess(value: unknown): LeaseProcess | null | string {
  if (value === undefined) return null;
  const { pid, startTime, pidNamespace } = (value ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(pid) || (pid as number) <= 0) return '"process.pid" must be a pid';
  if (startTime !== null && !Number.isInteger(startTime)) {
    return '"process.startTime" must be an integer or null';
  }
  if (pidNamespace !== null && typeof pidNamespace !== "string") {
    return '"process.pidNamespace" must be a string or null';
  }
  return { pid, startTime, pidNamespace } as LeaseProcess;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
