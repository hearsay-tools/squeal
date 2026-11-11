import { createServer, type Server } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { storePaths } from "../../src/core/store/paths.js";

/*
 * A stand-in daemon on a socket for CLI tests: it answers each request type
 * from a list, and records the types it got.
 */

export type Answer = Record<string, unknown>;

const servers: Server[] = [];

/** The requests that send writes (spec 021 D15). */
const WRITE_REQUESTS = new Set(["lease", "write", "write-status", "release"]);

/** Every request the stand-ins got since the last `closeFakeDaemons`, as parsed. */
export const received: Answer[] = [];

/**
 * A stand-in daemon. `answers` maps a request type to its answers in order;
 * the last one repeats. `onRequest` runs before each answer is sent.
 * Resolves to the request types it got, in order.
 */
export function fakeDaemon(
  path: string,
  answers: Record<string, Answer[]>,
  onRequest: (type: string) => void = () => {},
): Promise<string[]> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.on("error", clientGone);
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        // Spec 021 D15: a client asks for the write lease before it writes; a stand-in not told
        // to take writes refuses it, as a daemon before them does, and does not record it.
        if (WRITE_REQUESTS.has(request.type) && answers[request.type] === undefined) {
          socket.end(`${JSON.stringify({ ok: false, error: "unknown request type" })}\n`);
          return;
        }
        received.push(request);
        seen.push(request.type);
        onRequest(request.type);
        const queue = answers[request.type] ?? [{ ok: true, type: request.type }];
        const answer = (queue.length > 1 ? queue.shift() : queue[0]) as Answer;
        socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(seen));
  });
}

/**
 * A client whose probe timed out resets the connection, or has closed it before the answer is
 * written; that is no fault of the stand-in (row 011-220: `squeal start` probes every 50 ms with
 * a 100 ms timeout). Any other socket error is, and is thrown (review 0.1.322 S1).
 */
export function clientGone(error: NodeJS.ErrnoException): void {
  if (error.code !== "ECONNRESET" && error.code !== "EPIPE") throw error;
}

/** Closes every stand-in; call after each test. */
export function closeFakeDaemons(): void {
  for (const db of locks.splice(0)) db.close();
  for (const s of servers.splice(0)) s.close();
  received.length = 0;
}

/**
 * Takes the store of `commonDir` with an exclusive lock, so no other
 * connection can read it, until `closeFakeDaemons` (review 0.1.409 B1).
 */
export function lockStore(commonDir: string): void {
  const db = new DatabaseSync(storePaths(commonDir).database);
  db.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
  db.prepare("SELECT count(*) FROM worktrees").get();
  locks.push(db);
}

const locks: DatabaseSync[] = [];
