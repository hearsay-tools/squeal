import {
  type DaemonErrorResponse,
  type DaemonRequest,
  PAYLOAD_SCHEMA_VERSION,
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
    case "run-slow":
    case "stop":
      return { type: request.type };
    case "sync":
      if (request.after === undefined) return { type: "sync" };
      if (!Number.isInteger(request.after) || (request.after as number) < 0) {
        return '"after" must be a revision number';
      }
      return { type: "sync", after: request.after as number };
    case "run-all":
      if (request.force !== undefined && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      return { type: "run-all", force: request.force === true };
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
    default:
      return `unknown request type ${JSON.stringify(request.type)}`;
  }
}

export function errorResponse(error: string): DaemonErrorResponse {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}
