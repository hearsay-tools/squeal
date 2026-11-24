import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo, connect, createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import {
  acceptOf,
  FrameDecoder,
  OPCODE,
} from "../../src/core/runner-host/remote/providers/agent37/websocket.js";
import type { Certificates } from "../runner-host/remote/providers/agent37-servers.js";
import { serverFrame } from "../runner-host/remote/providers/agent37-servers.js";

/*
 * Spec 026 row 026-16: Agent37 as the daemon meets it, all on this
 * machine. The control plane is the row 026-15 mock (`mockAgent37Api`);
 * this file adds the rest of the path a real `ssh` takes through Squeal's
 * `remote-tunnel agent37`: an HTTP `CONNECT` proxy that sends
 * `<id>.squeal.test:443` to a TLS WebSocket server, which bridges each
 * upgraded connection to a non-root `sshd` on 127.0.0.1. The `sshd` takes
 * only a temporary key and runs every command with a HOME of the test's,
 * so the "instance" is a directory; an `ssh` first on PATH logs in as this
 * user (Agent37's `node` login does not exist here) and reads no real
 * `~/.ssh`.
 */

/** The tunnel host template the provider is given: certificates and the proxy know its domain. */
export const TUNNEL_TEMPLATE = "{id}.squeal.test";

/** Why this machine cannot run the Agent37 world, or `undefined`. */
export function agent37WorldMissing(): string | undefined {
  if (process.platform === "win32") return "Windows";
  for (const tool of ["openssl", "ssh", "ssh-keygen"]) {
    if (spawnSync("sh", ["-c", `command -v ${tool}`]).status !== 0) return `no ${tool}`;
  }
  return existsSync("/usr/sbin/sshd") ? undefined : "no /usr/sbin/sshd";
}

/** A CA and a server certificate for `localhost`, 127.0.0.1 and `*.squeal.test`. */
export function certificates(dir: string): Certificates {
  mkdirSync(dir, { recursive: true });
  const ssl = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  ssl(
    ["req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.pem", "-days", "2"]
      .concat(["-subj", "/CN=squeal-e2e-ca", "-addext", "basicConstraints=critical,CA:TRUE"])
      .concat(["-addext", "keyUsage=critical,keyCertSign"]),
  );
  ssl(["req", ...ec, "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  writeFileSync(
    join(dir, "san.ext"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:*.squeal.test\n",
  );
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
    caFile: join(dir, "ca.pem"),
    key: readFileSync(join(dir, "server.key"), "utf8"),
    cert: readFileSync(join(dir, "server.pem"), "utf8"),
  };
}

const portOf = (server: Server) => (server.address() as AddressInfo).port;

function closing(server: Server, sockets: Set<Socket>): () => Promise<void> {
  return () => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(() => resolve()));
  };
}

export interface Proxy {
  readonly url: string;
  /** Each `CONNECT` target, in order. */
  readonly targets: string[];
  close(): Promise<void>;
}

/** A `CONNECT` proxy: `*.squeal.test:443` goes to `tunnelPort`, any other host to 127.0.0.1. */
export async function routingProxy(tunnelPort: () => number): Promise<Proxy> {
  const targets: string[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpServer((_request, response) => response.writeHead(405).end());
  server.on("connection", (socket) => sockets.add(socket));
  server.on("connect", (request: IncomingMessage, client: Socket, head: Buffer) => {
    const target = request.url ?? "";
    targets.push(target);
    const colon = target.lastIndexOf(":");
    const host = target.slice(0, colon);
    const port = host.endsWith(".squeal.test") ? tunnelPort() : Number(target.slice(colon + 1));
    const upstream = connect(port, "127.0.0.1", () => {
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
  return {
    url: `http://127.0.0.1:${portOf(server)}`,
    targets,
    close: closing(server, sockets),
  };
}

export interface Bridge {
  readonly port: number;
  /** The `X-Agent37-Key` of each upgrade, in order. */
  readonly keys: (string | undefined)[];
  close(): Promise<void>;
}

/**
 * The tunnel endpoint: a TLS WebSocket server whose every upgraded
 * connection carries SSH to `sshPort`, binary frames each way. An upgrade
 * without `key` in `X-Agent37-Key` is refused with 401, as Agent37 does.
 */
export async function sshBridge(
  certs: Certificates,
  key: string,
  sshPort: () => number,
): Promise<Bridge> {
  const keys: (string | undefined)[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpsServer({ key: certs.key, cert: certs.cert });
  server.on("secureConnection", (socket) => sockets.add(socket));
  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    const given = request.headers["x-agent37-key"];
    keys.push(typeof given === "string" ? given : undefined);
    if (given !== key) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const accept = acceptOf(String(request.headers["sec-websocket-key"]));
    const ssh = connect(sshPort(), "127.0.0.1");
    sockets.add(ssh);
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const decoder = new FrameDecoder();
    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.opcode === OPCODE.binary || frame.opcode === OPCODE.continuation) {
          ssh.write(frame.payload);
        }
        if (frame.opcode === OPCODE.close) {
          socket.end(serverFrame(OPCODE.close, frame.payload));
          ssh.end();
        }
      }
    });
    ssh.on("data", (chunk: Buffer) => socket.write(serverFrame(OPCODE.binary, chunk)));
    ssh.on("end", () => socket.end(serverFrame(OPCODE.close, Buffer.from([0x03, 0xe8]))));
    ssh.on("error", () => socket.destroy());
    socket.on("error", () => ssh.destroy());
    socket.on("close", () => ssh.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: portOf(server), keys, close: closing(server, sockets) };
}

/** A free TCP port on 127.0.0.1, by listening on 0 and closing. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = portOf(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export interface Sshd {
  readonly port: number;
  /** The private key it accepts: the `sshKeyPath` the provider is given. */
  readonly key: string;
  /** A directory to put first on PATH: its `ssh` logs in as this user and reads only `-F /dev/null`. */
  readonly bin: string;
  stop(): void;
}

/** A non-root `sshd` on 127.0.0.1 whose logins run in `home` with it as HOME and this Node on PATH. */
export async function startSshd(dir: string, home: string): Promise<Sshd> {
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const at = (name: string) => join(dir, name);
  const runtime = at("runtime");
  mkdirSync(runtime, { recursive: true });
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", at("host")]);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", at("id")]);
  writeFileSync(at("authorized_keys"), readFileSync(at("id.pub")));
  const port = await freePort();
  writeFileSync(
    at("sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${at("host")}`,
      `AuthorizedKeysFile ${at("authorized_keys")}`,
      "StrictModes no",
      "UsePAM no",
      "PidFile none",
      // This machine's Node first on PATH, as Squeal's Node install puts its own there,
      // and a private XDG_RUNTIME_DIR so the mock instance has its own capacity pool.
      `ForceCommand HOME=${home}; XDG_RUNTIME_DIR=${runtime}; PATH=${dirname(process.execPath)}:/usr/bin:/bin; export HOME XDG_RUNTIME_DIR PATH; cd "$HOME" && exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"`,
      "",
    ].join("\n"),
  );
  const sshd = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", at("sshd_config")], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  sshd.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    log += chunk;
  });
  const deadline = Date.now() + 15_000;
  while (!log.includes("Server listening")) {
    if (Date.now() > deadline || sshd.exitCode !== null) throw new Error(`sshd: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ssh = execFileSync("sh", ["-c", "command -v ssh"], { encoding: "utf8" }).trim();
  const user = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
  const bin = at("bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "ssh"),
    `#!/bin/sh\nexec ${JSON.stringify(ssh)} -F /dev/null -o User=${user} "$@"\n`,
  );
  chmodSync(join(bin, "ssh"), 0o755);
  return { port, key: at("id"), bin, stop: () => sshd.kill("SIGTERM") };
}
