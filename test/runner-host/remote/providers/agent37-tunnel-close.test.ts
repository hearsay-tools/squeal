import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createServer as createTlsServer } from "node:tls";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import {
  closedBy,
  runTunnel,
} from "../../../../src/core/runner-host/remote/providers/agent37/tunnel.js";
import {
  acceptOf,
  FrameDecoder,
  OPCODE,
} from "../../../../src/core/runner-host/remote/providers/agent37/websocket.js";
import { type Certificates, makeCertificates, serverFrame } from "./agent37-servers.js";

/*
 * Row 026-30: a tunnel the server ends says why in ssh's stderr: a close
 * frame with its status code and a short, cleaned reason, or a connection
 * dropped with no close frame. A close SSH's own end asked for stays
 * silent, and the exit code stays 0 once the tunnel was open.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-tunnel-close-"));
let certificates: Certificates;
beforeAll(() => {
  certificates = makeCertificates(scratch);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_tunnel_close_key";

/** A TLS server on `localhost` that upgrades each connection, then hands the socket to `then`. */
async function upgrading(then: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createTlsServer({ key: certificates.key, cert: certificates.cert }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    let head = "";
    const read = (chunk: Buffer) => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      socket.removeListener("data", read);
      const key = /sec-websocket-key: *(\S+)/i.exec(head)?.[1] ?? "";
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptOf(key)}\r\n\r\n`,
        () => then(socket),
      );
    };
    socket.on("data", read);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  onTestFinished(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((done) => server.close(() => done()));
  });
  return (server.address() as AddressInfo).port;
}

function tunnel(port: number) {
  const input = new PassThrough();
  const output = new PassThrough();
  const failed: string[] = [];
  const settled = runTunnel({
    host: "localhost",
    port,
    keyEnv: "AGENT37_API_KEY",
    env: { NODE_EXTRA_CA_CERTS: certificates.caFile, AGENT37_API_KEY: KEY },
    input,
    output,
    fail: (message) => failed.push(message),
    connectMs: 10_000,
    closeMs: 500,
  });
  return { input, failed, settled };
}

const close = (code: number, reason: string) => {
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2);
  return serverFrame(OPCODE.close, payload);
};

describe("why an open Agent37 tunnel ended (row 026-30)", () => {
  it("names a close the server started by its code and its reason", async () => {
    const port = await upgrading((socket) => socket.write(close(1001, "idle reset")));
    const run = tunnel(port);
    expect(await run.settled).toBe(0);
    expect(run.failed).toEqual([
      "tunnel to localhost: server closed WebSocket (code 1001: idle reset)",
    ]);
  });

  it("names a close frame with no status code, and one with a code alone", async () => {
    const bare = tunnel(
      await upgrading((socket) => socket.write(serverFrame(OPCODE.close, Buffer.alloc(0)))),
    );
    expect(await bare.settled).toBe(0);
    expect(bare.failed).toEqual(["tunnel to localhost: server closed WebSocket (no status code)"]);
    const coded = tunnel(await upgrading((socket) => socket.write(close(1011, ""))));
    expect(await coded.settled).toBe(0);
    expect(coded.failed).toEqual(["tunnel to localhost: server closed WebSocket (code 1011)"]);
  });

  it("names a connection the peer dropped with no close frame", async () => {
    const run = tunnel(await upgrading((socket) => socket.destroy()));
    expect(await run.settled).toBe(0);
    expect(run.failed).toEqual(["tunnel to localhost: connection closed by peer"]);
  });

  it("stays silent when SSH's end started the close", async () => {
    const run = tunnel(
      await upgrading((socket) => {
        const decoder = new FrameDecoder();
        socket.on("data", (chunk: Buffer) => {
          for (const frame of decoder.push(chunk))
            if (frame.opcode === OPCODE.close) socket.end(close(1000, "bye"));
        });
        setTimeout(() => run.input.end(), 50);
      }),
    );
    expect(await run.settled).toBe(0);
    expect(run.failed).toEqual([]);
  });

  it("keeps a reason to one clean line of at most 120 characters", () => {
    const payload = Buffer.concat([
      Buffer.from([0x0f, 0xa0]),
      Buffer.from(`  bad\r\nline\u0000\u001b[31m ${"x".repeat(300)}`),
    ]);
    const text = closedBy(payload);
    expect(text).toMatch(/^server closed WebSocket \(code 4000: bad line \[31m x+\)$/);
    expect(/\p{Cc}/u.test(text)).toBe(false);
    const reason = /: (.*)\)$/.exec(text)?.[1] ?? "";
    expect(reason.length).toBeLessThanOrEqual(120);
  });
});
