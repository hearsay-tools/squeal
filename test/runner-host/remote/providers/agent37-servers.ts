import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo, connect, type Server, type Socket } from "node:net";
import { join } from "node:path";
import {
  acceptOf,
  type Frame,
  FrameDecoder,
  OPCODE,
} from "../../../../src/core/runner-host/remote/providers/agent37/websocket.js";

/*
 * Spec 026 row 026-15: local stand-ins for everything Agent37 is on the
 * network, so no test reaches it: a CA and a `localhost` certificate made
 * with `openssl`, an HTTP `CONNECT` proxy that records what it carried,
 * and an HTTPS server that upgrades to a WebSocket.
 */

export interface Certificates {
  /** The CA's PEM file, for `NODE_EXTRA_CA_CERTS`. */
  readonly caFile: string;
  readonly key: string;
  readonly cert: string;
}

/** A throwaway CA and a server certificate it signed for `localhost` and 127.0.0.1. */
export function makeCertificates(dir: string): Certificates {
  const at = (name: string) => join(dir, name);
  const ssl = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  ssl(
    ["req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.pem", "-days", "2"]
      .concat(["-subj", "/CN=squeal-test-ca", "-addext", "basicConstraints=critical,CA:TRUE"])
      .concat(["-addext", "keyUsage=critical,keyCertSign"]),
  );
  ssl(["req", ...ec, "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  writeFileSync(at("san.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
  ssl(
    ["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key"].concat([
      "-CAcreateserial",
      "-out",
      "server.pem",
      "-days",
      "2",
      "-extfile",
      "san.ext",
    ]),
  );
  return {
    caFile: at("ca.pem"),
    key: readFileSync(at("server.key"), "utf8"),
    cert: readFileSync(at("server.pem"), "utf8"),
  };
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function closeAll(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** What the proxy was asked: each `CONNECT` target and its `Proxy-Authorization`. */
export interface ProxySeen {
  readonly target: string;
  readonly authorization: string | undefined;
}

/** An HTTP proxy that only tunnels `CONNECT`, to any target. */
export async function connectProxy(): Promise<{
  readonly url: (userinfo?: string) => string;
  readonly seen: ProxySeen[];
  close(): Promise<void>;
}> {
  const seen: ProxySeen[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpServer((_request, response) => response.writeHead(405).end());
  server.on("connection", (socket) => sockets.add(socket));
  server.on("connect", (request: IncomingMessage, client: Socket, head: Buffer) => {
    const target = request.url ?? "";
    seen.push({ target, authorization: request.headers["proxy-authorization"] });
    const [host, port] = [
      target.slice(0, target.lastIndexOf(":")),
      target.slice(target.lastIndexOf(":") + 1),
    ];
    const upstream = connect(Number(port), host === "localhost" ? "127.0.0.1" : host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = portOf(server);
  return {
    url: (userinfo) => `http://${userinfo === undefined ? "" : `${userinfo}@`}127.0.0.1:${port}`,
    seen,
    close: () => closeAll(server, sockets),
  };
}

/** A server frame: unmasked, as RFC 6455 has a server send them. */
export function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const n = payload.length;
  const first = (fin ? 0x80 : 0) | opcode;
  if (n < 126) return Buffer.concat([Buffer.from([first, n]), payload]);
  if (n < 65_536) {
    const head = Buffer.from([first, 126, 0, 0]);
    head.writeUInt16BE(n, 2);
    return Buffer.concat([head, payload]);
  }
  const head = Buffer.alloc(10);
  head[0] = first;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

/** One upgraded connection as the WebSocket server saw it. */
export interface WsSession {
  readonly headers: IncomingMessage["headers"];
  readonly frames: Frame[];
}

/**
 * An HTTPS server on `localhost` that upgrades to a WebSocket. Each session:
 * `greet` frames sent right after the upgrade, then every binary frame
 * echoed back, and a close answered with a close. `refuse` answers the
 * upgrade with that status line instead.
 */
export async function webSocketServer(
  certificates: Certificates,
  behaviour: { readonly greet?: readonly Buffer[]; readonly refuse?: string } = {},
): Promise<{ readonly port: number; readonly sessions: WsSession[]; close(): Promise<void> }> {
  const sessions: WsSession[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpsServer({ key: certificates.key, cert: certificates.cert });
  server.on("secureConnection", (socket) => sockets.add(socket));
  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    const session: WsSession = { headers: request.headers, frames: [] };
    sessions.push(session);
    if (behaviour.refuse !== undefined) {
      socket.end(`HTTP/1.1 ${behaviour.refuse}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const key = String(request.headers["sec-websocket-key"]);
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptOf(key)}\r\n\r\n`,
    );
    for (const frame of behaviour.greet ?? []) socket.write(frame);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        session.frames.push(frame);
        if (frame.opcode === OPCODE.binary) socket.write(serverFrame(OPCODE.binary, frame.payload));
        if (frame.opcode === OPCODE.close) socket.end(serverFrame(OPCODE.close, frame.payload));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: portOf(server), sessions, close: () => closeAll(server, sockets) };
}
