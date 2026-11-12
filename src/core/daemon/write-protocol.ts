import { isAbsolute } from "node:path";
import type { WorktreeId } from "../types/common.js";
import type {
  ImportRequest,
  ImportStatusRequest,
  KeepRequest,
  KeepStatusRequest,
  LeaseProcess,
  LeaseRequest,
  ReleaseRequest,
  WriteRequest,
  WriteStatusRequest,
} from "../types/daemon-writes.js";
import { parseKeep } from "./keep-protocol.js";
import { parseBatch } from "./write-batch.js";

export type WriteRequests = LeaseRequest | ReleaseRequest | WriteRequest | WriteStatusRequest;

const TYPES = new Set(["lease", "release", "write", "write-status"]);

/** Whether `request` is one of the requests that send writes. */
export function isWriteRequest(request: { readonly type: string }): request is WriteRequests {
  return TYPES.has(request.type);
}

/** Spec 021 D15 (row 021-20): `squeal import`'s requests. */
export type ImportRequests = ImportRequest | ImportStatusRequest;

const IMPORT_TYPES = new Set(["import", "import-status"]);

/** Whether `request` asks the daemon to import an export file, or how one went. */
export function isImportRequest(request: { readonly type: string }): request is ImportRequests {
  return IMPORT_TYPES.has(request.type);
}

/** Spec 021 D15 (row 021-20, part two): the code gate's kept files' requests. */
export type KeepRequests = KeepRequest | KeepStatusRequest;

const KEEP_TYPES = new Set(["keep", "keep-status"]);

/** Whether `request` asks the daemon to try one write of a file the gate keeps, or how one went. */
export function isKeepRequest(request: { readonly type: string }): request is KeepRequests {
  return KEEP_TYPES.has(request.type);
}

/**
 * Spec 021 D15 (rows 021-16, 021-20): the requests that send writes, an
 * import or a kept file's write, parsed; a string says why one is not a
 * request, `undefined` that it is none of them.
 */
export function parseWriteRequest(
  request: Record<string, unknown>,
): WriteRequests | ImportRequests | KeepRequests | string | undefined {
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
    case "import":
      return parseImport(request);
    case "import-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "import-status", requestId: request.requestId };
    case "keep":
      return parseKeep(request);
    case "keep-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "keep-status", requestId: request.requestId };
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

/** An export file the daemon is to import (row 021-20). */
function parseImport(request: Record<string, unknown>): ImportRequest | string {
  const { worktreeId, storeSchema, file, fileHash, dryRun } = request;
  if (!isText(worktreeId)) return '"worktreeId" must be a non-empty string';
  if (!Number.isInteger(storeSchema)) return '"storeSchema" must be an integer';
  if (!isText(file) || !isAbsolute(file)) return '"file" must be an absolute path';
  if (typeof fileHash !== "string" || !/^[0-9a-f]{64}$/.test(fileHash)) {
    return '"fileHash" must be a SHA-256 in hex';
  }
  if (typeof dryRun !== "boolean") return '"dryRun" must be true or false';
  return {
    type: "import",
    worktreeId: worktreeId as WorktreeId,
    storeSchema: storeSchema as number,
    file,
    fileHash,
    dryRun,
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
