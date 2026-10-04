import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import type { AbsolutePath, DaemonRequest, DaemonResponse } from "../types/index.js";
import { errorResponse, MAX_LINE_BYTES, parseRequest } from "./protocol.js";

/** Synchronous by design: an answer never waits for scheduler work (spec 001 D9 budget). */
export type DaemonHandler = (request: DaemonRequest) => DaemonResponse;

export interface DaemonServer {
  readonly socketPath: AbsolutePath;
  /** Stops listening, drops open connections, and unlinks the socket. */
  close(): Promise<void>;
}

/** A client that connects and sends nothing is dropped after this long. */
const IDLE_CONNECTION_MS = 2_000;

/**
 * Binds the daemon socket. The caller must hold the worktree's lock: any
 * file at `socketPath` is then stale and is unlinked first. Spec 001 D10:
 * "The winner unlinks a stale socket, binds its own". The socket is made
 * private to the user, since anyone who can connect can start runs.
 */
export async function createDaemonServer(
  socketPath: AbsolutePath,
  handle: DaemonHandler,
): Promise<DaemonServer> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  rmSync(socketPath, { force: true });
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    serve(socket, handle);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);
  let closing: Promise<void> | null = null;
  return {
    socketPath,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of connections) socket.destroy();
      });
      return closing;
    },
  };
}

function serve(socket: Socket, handle: DaemonHandler): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end < 0) {
      if (buffer.length > MAX_LINE_BYTES) answer(socket, errorResponse("request too long"));
      return;
    }
    const request = parseRequest(buffer.slice(0, end));
    buffer = "";
    if (typeof request === "string") {
      answer(socket, errorResponse(request));
      return;
    }
    let response: DaemonResponse;
    try {
      response = handle(request);
    } catch (error) {
      response = errorResponse(`daemon error: ${String(error)}`);
    }
    answer(socket, response);
  });
}

function answer(socket: Socket, response: DaemonResponse): void {
  socket.removeAllListeners("data");
  socket.end(`${JSON.stringify(response)}\n`);
}
