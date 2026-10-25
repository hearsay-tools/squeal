import { createServer, type Server } from "node:net";

/*
 * A stand-in daemon on a socket for CLI tests: it answers each request type
 * from a list, and records the types it got.
 */

export type Answer = Record<string, unknown>;

const servers: Server[] = [];

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
      // A client whose probe timed out resets the connection; that is no fault of the stand-in
      // (row 011-220: `squeal start` probes every 50 ms with a 100 ms timeout).
      socket.on("error", () => {});
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
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

/** Closes every stand-in; call after each test. */
export function closeFakeDaemons(): void {
  for (const s of servers.splice(0)) s.close();
  received.length = 0;
}
