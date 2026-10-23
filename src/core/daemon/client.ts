import { statSync } from "node:fs";
import { createConnection } from "node:net";
import type {
  AbsolutePath,
  DaemonRecord,
  DaemonRequest,
  DaemonResponse,
  PingResponse,
} from "../types/index.js";

/** A failed socket request. `code` is the socket error code, or `ETIMEDOUT`. */
export interface DaemonRequestError extends Error {
  readonly code: string;
}

/**
 * The socket file a daemon listens on, as a stat reads it. Each incarnation
 * renames a new file over the worktree's one socket path (`bindAt`), so a
 * file with these numbers names one incarnation's listener (row 011-151).
 */
export interface DaemonEndpoint {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly ctimeNs: bigint;
  readonly birthtimeNs: bigint;
}

/** The file at `socketPath` now; `null` with none. */
export function endpointAt(socketPath: AbsolutePath): DaemonEndpoint | null {
  try {
    const { dev, ino, ctimeNs, birthtimeNs } = statSync(socketPath, { bigint: true });
    return { dev, ino, ctimeNs, birthtimeNs };
  } catch {
    return null;
  }
}

function sameEndpoint(a: DaemonEndpoint | null, b: DaemonEndpoint): boolean {
  return (
    a !== null &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.ctimeNs === b.ctimeNs &&
    a.birthtimeNs === b.birthtimeNs
  );
}

/** A daemon's endpoint, with the ping that proved it (`pinDaemon`). */
export interface PinnedDaemon {
  readonly endpoint: DaemonEndpoint;
  readonly ping: PingResponse;
}

/**
 * Row 011-151 (review 0.1.277-r2, B1): the endpoint of `record`'s daemon,
 * proved by a ping over a connection to it: the file at the path is the same
 * before the connect and after it, and the daemon that answers has the
 * record's start time and version, which every release's ping answers.
 * `null` when the path holds another daemon, or none answers in `timeoutMs`.
 * A request with this endpoint then reaches that daemon or nothing.
 */
export async function pinDaemon(
  record: Pick<DaemonRecord, "socketPath" | "startedAt" | "squealVersion">,
  timeoutMs: number,
): Promise<PinnedDaemon | null> {
  const endpoint = endpointAt(record.socketPath);
  if (endpoint === null) return null;
  try {
    const ping = await requestDaemon(record.socketPath, { type: "ping" }, timeoutMs, endpoint);
    if (!ping.ok || ping.type !== "ping") return null;
    const same = ping.startedAt === record.startedAt && ping.squealVersion === record.squealVersion;
    return same ? { endpoint, ping } : null;
  } catch {
    return null;
  }
}

/**
 * Sends one request to a daemon socket and reads its one-line answer.
 * Rejects with the socket error (`ENOENT`: no socket, `ECONNREFUSED`: nobody
 * listening) or `ETIMEDOUT` after `timeoutMs`, never later. Spec 001 D9:
 * hooks use "the socket only for liveness and nudges with a 100 ms timeout".
 * With `endpoint` (`pinDaemon`), the request is written only when the file
 * at the path, read once connected, is still that one: a successor that
 * replaced it since got the connection, which is closed unwritten and
 * rejects with `ESTALE`.
 */
export function requestDaemon(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  timeoutMs: number,
  endpoint?: DaemonEndpoint,
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (error: Error | null, response?: DaemonResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response as DaemonResponse);
    };
    const timer = setTimeout(
      () => settle(failure("ETIMEDOUT", `no answer from ${socketPath} in ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      if (endpoint !== undefined && !sameEndpoint(endpointAt(socketPath), endpoint)) {
        settle(failure("ESTALE", `${socketPath} is another daemon's socket now`));
        return;
      }
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        settle(null, JSON.parse(buffer.slice(0, end)) as DaemonResponse);
      } catch {
        settle(failure("EPROTO", `malformed answer from ${socketPath}`));
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) =>
      settle(failure(error.code ?? "EIO", error.message)),
    );
    socket.on("close", () =>
      settle(failure("ECONNRESET", `${socketPath} closed without an answer`)),
    );
  });
}

function failure(code: string, message: string): DaemonRequestError {
  return Object.assign(new Error(message), { code });
}
