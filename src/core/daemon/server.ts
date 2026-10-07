import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { basename, dirname, join } from "node:path";
import type { AbsolutePath, DaemonRequest, DaemonResponse } from "../types/index.js";
import { errorResponse, MAX_LINE_BYTES, parseRequest } from "./protocol.js";

/** Synchronous by design: an answer never waits for scheduler work (spec 001 D9 budget). */
export type DaemonHandler = (request: DaemonRequest) => DaemonResponse;

export interface DaemonServer {
  readonly socketPath: AbsolutePath;
  /** Stops listening, drops open connections, and unlinks the socket if it is still the one bound. */
  close(): Promise<void>;
}

/** A client that connects and sends nothing is dropped after this long. */
const IDLE_CONNECTION_MS = 2_000;

/**
 * Binds the daemon socket. The caller must hold the worktree's lock: any
 * file at `socketPath` is then stale and is replaced. Spec 001 D10:
 * "The winner unlinks a stale socket, binds its own". The socket is made
 * private to the user, since anyone who can connect can start runs.
 *
 * Board row 001-77: the path is keyed by the root alone, so a daemon whose
 * root another repository or a fresh clone took over shares it with the
 * newcomer, and libuv unlinks the path a server listened on when it closes.
 * The server therefore listens at a staging name beside the socket and
 * renames it into place; closing unlinks the socket path only while it is
 * still the file this server bound.
 */
export async function createDaemonServer(
  socketPath: AbsolutePath,
  handle: DaemonHandler,
): Promise<DaemonServer> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    serve(socket, handle);
  });
  const bound = await bindAt(server, socketPath);
  let closing: Promise<void> | null = null;
  return {
    socketPath,
    close() {
      closing ??= new Promise<void>((resolve) => {
        if (stillBound(socketPath, bound)) rmSync(socketPath, { force: true });
        server.close(() => resolve());
        for (const socket of connections) socket.destroy();
      });
      return closing;
    },
  };
}

interface Inode {
  readonly dev: number;
  readonly ino: number;
}

/**
 * Listens at a random staging name no longer than the socket's own, so the
 * path stays within `MAX_SOCKET_PATH_BYTES`, then renames it over
 * `socketPath`, which replaces a stale file in one step.
 */
async function bindAt(server: Server, socketPath: AbsolutePath): Promise<Inode> {
  const name = `.${randomBytes(8).toString("hex")}`.slice(
    0,
    Math.max(2, basename(socketPath).length),
  );
  const staging = join(dirname(socketPath), name);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(staging, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(staging, 0o600);
    const { dev, ino } = statSync(staging);
    renameSync(staging, socketPath);
    return { dev, ino };
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
}

function stillBound(socketPath: AbsolutePath, bound: Inode): boolean {
  try {
    const { dev, ino } = statSync(socketPath);
    return dev === bound.dev && ino === bound.ino;
  } catch {
    return false;
  }
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
