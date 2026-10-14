// False positive for the error-text signal: the code under test is wrong
// (its client dials the wrong port), and the error reads like a missing server.
import { createServer } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
const server = createServer((_q, r) => r.end("ok"));
let port = 0;
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
const clientUrl = (_p: number) => "http://127.0.0.1:59321/"; // the bug: ignores its port
test("client reaches the server it was given", async () => {
  expect(await (await fetch(clientUrl(port))).text()).toBe("ok");
});
