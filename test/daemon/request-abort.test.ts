import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 011-344: `requestDaemon`'s abort signal ends a request on the wire at
 * once: the socket closes and the request rejects `ABORT_ERR`, long before
 * its timeout.
 */

let scratch: string;
let server: Server;
const sockets: Socket[] = [];
let closed: Promise<void>;

beforeEach(async () => {
  scratch = mkdtempSync("/tmp/sq-");
  let sawClose: () => void = () => {};
  closed = new Promise((done) => {
    sawClose = done;
  });
  // Accepts and never answers, as a paused daemon.
  server = createServer((socket) => {
    sockets.push(socket);
    socket.resume();
    socket.on("close", () => sawClose());
    socket.on("error", () => {});
  });
  await new Promise<void>((done) => server.listen(join(scratch, "d.sock"), () => done()));
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
  server.close();
  rmSync(scratch, { recursive: true, force: true });
});

const socketPath = () => join(scratch, "d.sock") as AbsolutePath;

describe("requestDaemon with an abort signal (row 011-344)", () => {
  it("rejects ABORT_ERR and closes the socket when aborted on the wire", async () => {
    const abort = new AbortController();
    const started = performance.now();
    const request = requestDaemon(socketPath(), { type: "ping" }, 5_000, undefined, abort.signal);
    setTimeout(() => abort.abort(), 50);

    await expect(request).rejects.toMatchObject({ code: "ABORT_ERR" });
    await closed;
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("rejects ABORT_ERR at once on a signal already aborted, and connects nowhere", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      requestDaemon(socketPath(), { type: "ping" }, 5_000, undefined, abort.signal),
    ).rejects.toMatchObject({ code: "ABORT_ERR" });
    await new Promise((done) => setTimeout(done, 50));
    expect(sockets).toHaveLength(0);
  });

  it("without a signal still times out ETIMEDOUT", async () => {
    await expect(requestDaemon(socketPath(), { type: "ping" }, 100)).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
  });
});
