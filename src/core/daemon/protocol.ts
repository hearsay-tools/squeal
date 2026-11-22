import { type AbsolutePath, PAYLOAD_SCHEMA_VERSION, type RelativePath } from "../types/common.js";
import type {
  DaemonErrorResponse,
  DaemonRequest,
  PromoteRequest,
  RunGroupPathsRequest,
  SyncRequest,
} from "../types/daemon.js";
import type { TestFileRef } from "../types/keys.js";
import type { NarrowRunOptions } from "../types/scheduler.js";
import { parseWriteRequest } from "./write-protocol.js";

/** A request line is small; anything longer is not a Squeal client. */
export const MAX_LINE_BYTES = 64 * 1024;

/**
 * Spec 021 D15 (row 021-16): a `write` line carries a batch of statements;
 * a registration writes a view per known state, about 1.5 MB at 15,000.
 * Row 021-20 (review 0.1.450 B1): a `keep` line carries one file's coverage
 * record or its results, past 64 KiB for a file that loads many sources or
 * has many checks. Only a line that starts as one of these requests may
 * grow this long.
 */
export const MAX_WRITE_LINE_BYTES = 32 * 1024 * 1024;

/** The start of every line `requestDaemon` writes for a `write` or a `keep` request. */
const LONG_LINE_STARTS = [
  '{"type":"write",',
  '{"type":"keep",',
  // Row 023-40c: an ask carries every path a change names.
  '{"type":"commit-ask",',
] as const;

/** How long the request line that begins with `start` may be. */
export function lineLimit(start: string): number {
  return LONG_LINE_STARTS.some((head) => start.startsWith(head))
    ? MAX_WRITE_LINE_BYTES
    : MAX_LINE_BYTES;
}

/** Parses one request line. A string is the reason it is not a request. */
export function parseRequest(line: string): DaemonRequest | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "request is not valid JSON";
  }
  if (typeof value !== "object" || value === null) return "request is not a JSON object";
  const request = value as Record<string, unknown>;
  switch (request.type) {
    case "ping":
    case "nudge":
    case "retry":
    case "run-slow":
    case "stop":
    case "hold":
    case "resume":
      return { type: request.type };
    // An older CLI's `after` and `resolvedSince` are ignored (task 001-258).
    case "sync":
      return parseSync(request.paths);
    case "run-all":
      if (request.force !== undefined && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      if (request.observeIgnored !== undefined && typeof request.observeIgnored !== "boolean") {
        return '"observeIgnored" must be true or false';
      }
      if (request.lane !== undefined && request.lane !== "fast" && request.lane !== "slow") {
        return '"lane" must be "fast" or "slow"';
      }
      return {
        type: "run-all",
        force: request.force === true,
        ...(request.observeIgnored === true ? { observeIgnored: true } : {}),
        ...(request.lane === undefined ? {} : { lane: request.lane }),
      };
    case "step-down":
      if (typeof request.version !== "string") return '"version" must be a string';
      return { type: "step-down", version: request.version };
    case "run-all-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-all-status", requestId: request.requestId };
    case "run-slow-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-slow-status", requestId: request.requestId };
    case "run-group":
      if (!isText(request.group)) return '"group" must be a non-empty string';
      return { type: "run-group", group: request.group };
    case "run-group-paths":
      return parseGroupPaths(request);
    case "run-group-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-group-status", requestId: request.requestId };
    case "sync-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "sync-status", requestId: request.requestId };
    case "hold-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "hold-status", requestId: request.requestId };
    case "commit-ask":
    case "commit-read":
      return parseCommitAsk(request);
    case "promote":
      return parsePromote(request);
    case "focus": {
      const { testFiles, texts, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (!Array.isArray(texts) || texts.length === 0 || !texts.every(isText)) {
        return '"texts" must be a list of non-empty strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "focus", testFiles: refs, texts: [...texts], withinMs };
    }
    default:
      return parseWriteRequest(request) ?? `unknown request type ${JSON.stringify(request.type)}`;
  }
}

/** Spec 011 C15: a named wait's promotion; row 024-01, its optional `wakeCatchUp`. */
function parsePromote(request: Record<string, unknown>): PromoteRequest | string {
  const { testFiles, withinMs, wakeCatchUp } = request;
  if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
    return '"testFiles" must be a list of { project, path } strings';
  }
  if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
    return '"withinMs" must be a number of milliseconds';
  }
  if (wakeCatchUp !== undefined && typeof wakeCatchUp !== "boolean") {
    return '"wakeCatchUp" must be a boolean';
  }
  const refs = testFiles.map(({ project, path }) => ({ project, path }));
  // Row 024-01: present only when true.
  const wake = wakeCatchUp === true ? { wakeCatchUp: true as const } : {};
  return { type: "promote", testFiles: refs, withinMs, ...wake };
}

/** Row 023-40c (spec 023 D7.3 as amended): a commit daemon's ask, or a read of its asks. */
function parseCommitAsk(request: Record<string, unknown>): DaemonRequest | string {
  if (request.type === "commit-read") {
    const { owners } = request;
    if (owners === undefined) return { type: "commit-read" };
    if (!Array.isArray(owners) || !owners.every(isText))
      return '"owners" must be a list of non-empty strings';
    return { type: "commit-read", owners: [...owners] };
  }
  const { owner, changed, named, allMissing, root } = request;
  if (root !== undefined && !isText(root)) return '"root" must be a non-empty string';
  if (!isText(owner)) return '"owner" must be a non-empty string';
  if (!Array.isArray(changed) || !changed.every(isText))
    return '"changed" must be a list of non-empty strings';
  if (!Array.isArray(named) || !named.every(isText))
    return '"named" must be a list of non-empty strings';
  if (typeof allMissing !== "boolean") return '"allMissing" must be true or false';
  return {
    type: "commit-ask",
    owner,
    changed: changed as RelativePath[],
    named: named as RelativePath[],
    allMissing,
    ...(root === undefined ? {} : { root: root as AbsolutePath }),
  };
}

/** Row 011-234: a sync with a named wait's source paths, whose readers its answer names. */
function parseSync(paths: unknown): SyncRequest | string {
  if (paths === undefined) return { type: "sync" };
  if (!Array.isArray(paths) || !paths.every(isText)) {
    return '"paths" must be a list of non-empty strings';
  }
  return { type: "sync", paths: [...paths] };
}

/** Row 019-49: a narrow run names its group and at least one path. */
function parseGroupPaths(request: Record<string, unknown>): RunGroupPathsRequest | string {
  const { group, paths, at, lead } = request;
  if (!isText(group)) return '"group" must be a non-empty string';
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isText)) {
    return '"paths" must be a non-empty list of non-empty strings';
  }
  if (at !== undefined && at !== true) return '"at" must be true when given';
  // Row 023-34 (review wave-20 B2): the call named its files. Row 023-41: an `owner` an
  // older CLI sends is ignored; the covered-files id keys the `at` flag.
  if (lead !== undefined && lead !== true) return '"lead" must be true when given';
  return {
    type: "run-group-paths",
    group,
    paths: [...paths],
    ...(at === true ? { at } : {}),
    ...(lead === true ? { lead } : {}),
  };
}

/** Row 023-34: a narrow request's options for the scheduler (`NarrowRunOptions`). */
export function narrowOptionsOf(request: RunGroupPathsRequest): NarrowRunOptions {
  return {
    ...(request.lead === true ? { lead: true } : {}),
    // Row 023-36 (T3): so the daemon flags the accepted request's files.
    ...(request.at === true ? { at: true } : {}),
  };
}

function isTestFileRef(value: unknown): value is TestFileRef {
  if (typeof value !== "object" || value === null) return false;
  const { project, path } = value as Record<string, unknown>;
  return typeof project === "string" && typeof path === "string";
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function errorResponse(error: string): DaemonErrorResponse {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}
