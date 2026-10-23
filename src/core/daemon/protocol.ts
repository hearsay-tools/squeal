import {
  type DaemonErrorResponse,
  type DaemonRequest,
  PAYLOAD_SCHEMA_VERSION,
  type TestFileRef,
} from "../types/index.js";

/** A request line is small; anything longer is not a Squeal client. */
export const MAX_LINE_BYTES = 64 * 1024;

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
      return { type: "sync" };
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
    case "sync-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "sync-status", requestId: request.requestId };
    case "hold-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "hold-status", requestId: request.requestId };
    case "promote": {
      const { testFiles, withinMs } = request;
      if (!Array.isArray(testFiles) || !testFiles.every(isTestFileRef)) {
        return '"testFiles" must be a list of { project, path } strings';
      }
      if (typeof withinMs !== "number" || !Number.isFinite(withinMs) || withinMs < 0) {
        return '"withinMs" must be a number of milliseconds';
      }
      const refs = testFiles.map(({ project, path }) => ({ project, path }));
      return { type: "promote", testFiles: refs, withinMs };
    }
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
      return `unknown request type ${JSON.stringify(request.type)}`;
  }
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
