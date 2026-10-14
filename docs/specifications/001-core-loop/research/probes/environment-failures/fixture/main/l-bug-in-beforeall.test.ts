// False positive for "file-level error + network text": the server under test
// is product code, its bug surfaces in beforeAll exactly as a missing server does.
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startServer } from "./server.js";
let server: Server;
let body = "";
beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  body = await (await fetch(`${started.url}/health`)).text();
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
test("health", () => expect(body).toBe("ok"));
