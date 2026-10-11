import { createServer, type Server } from "node:net";

/*
 * A stand-in daemon on a socket for CLI tests: it answers each request type
 * from a list, and records the types it got.
 */

export type Answer = Record<string, unknown>;

const servers: Server[] = [];

/**
 * A stand-in daemon. `answers` maps a request type to its answers in order;
 * the last one repeats. Resolves to the request types it got, in order.
 */
export function fakeDaemon(path: string, answers: Record<string, Answer[]>): Promise<string[]> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        seen.push(request.type);
        const queue = answers[request.type] ?? [{ ok: true, type: request.type }];
        const answer = (queue.length > 1 ? queue.shift() : queue[0]) as Answer;
        socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(seen));
  });
}

/** Closes every stand-in; call after each test. */
export function closeFakeDaemons(): void {
  for (const s of servers.splice(0)) s.close();
}
