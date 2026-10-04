import { createConnection } from "node:net";
import type { AbsolutePath, DaemonRequest, DaemonResponse } from "../types/index.js";

/** A failed socket request. `code` is the socket error code, or `ETIMEDOUT`. */
export interface DaemonRequestError extends Error {
  readonly code: string;
}

/**
 * Sends one request to a daemon socket and reads its one-line answer.
 * Rejects with the socket error (`ENOENT`: no socket, `ECONNREFUSED`: nobody
 * listening) or `ETIMEDOUT` after `timeoutMs`, never later. Spec 001 D9:
 * hooks use "the socket only for liveness and nudges with a 100 ms timeout".
 */
export function requestDaemon(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  timeoutMs: number,
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
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
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
