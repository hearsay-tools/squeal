import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { remoteTunnelCommand } from "../../src/cli/remote-tunnel.js";
import { OPCODE } from "../../src/core/runner-host/remote/providers/agent37/websocket.js";
import {
  type Certificates,
  connectProxy,
  makeCertificates,
  serverFrame,
  webSocketServer,
} from "../runner-host/remote/providers/agent37-servers.js";

/*
 * Spec 026 D7.3.2, D12.6 (row 026-15): `squeal remote-tunnel agent37 <id>`
 * bridges SSH's stdio to a WebSocket over real TLS, trusted through
 * `NODE_EXTRA_CA_CERTS`, directly or through an HTTP `CONNECT` proxy. Every
 * server is local; the key is a test value that must never be printed.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-tunnel-"));
let certificates: Certificates;
beforeAll(() => {
  certificates = makeCertificates(scratch);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_tunnel_key_7f3a";
const PROXY_PASSWORD = "proxy-p@ss";

function capture(): { io: CliIo; text: () => string } {
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  return { io: { stdout: add, stderr: add }, text: () => text };
}

/** Runs the tunnel to `port` with `env`, feeding `chunks` then ending stdin; resolves its code, stdout and stderr. */
async function tunnel(port: number, env: NodeJS.ProcessEnv, chunks: readonly Buffer[]) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => out.push(chunk));
  const { io, text } = capture();
  const running = remoteTunnelCommand(
    ["agent37", "abc123def0", "--host", "localhost", "--port", String(port)],
    io,
    { stdin, stdout, env: { NODE_EXTRA_CA_CERTS: certificates.caFile, ...env } },
  );
  // Each chunk once the upgrade is through: a chunk written early waits in stdin.
  for (const chunk of chunks) stdin.write(chunk);
  setTimeout(() => stdin.end(), 200);
  const code = await running;
  return { code, stdout: Buffer.concat(out), stderr: text() };
}

async function server(behaviour?: Parameters<typeof webSocketServer>[1]) {
  const ws = await webSocketServer(certificates, behaviour);
  onTestFinished(() => ws.close());
  return ws;
}

async function proxy() {
  const p = await connectProxy();
  onTestFinished(() => p.close());
  return p;
}

const small = Buffer.from("SSH-2.0-OpenSSH_9.6\r\n");
const medium = Buffer.alloc(300, 7);
const large = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251));

describe("squeal remote-tunnel agent37 (row 026-15)", () => {
  it("bridges binary frames over direct TLS: ping, fragments, 7/16/64-bit lengths, close", async () => {
    const ws = await server({
      greet: [
        serverFrame(OPCODE.ping, Buffer.from("p1")),
        serverFrame(OPCODE.binary, Buffer.from("frag-"), false),
        serverFrame(OPCODE.continuation, Buffer.from("ment|")),
      ],
    });
    const run = await tunnel(ws.port, { AGENT37_API_KEY: KEY }, [small, medium, large]);
    expect(run.code).toBe(0);
    expect(
      run.stdout.equals(Buffer.concat([Buffer.from("frag-ment|"), small, medium, large])),
    ).toBe(true);
    const [session] = ws.sessions;
    expect(session?.headers["x-agent37-key"]).toBe(KEY);
    // The pong goes whenever the ping arrives; the data frames keep their order, and close is last.
    const frames = session?.frames ?? [];
    const data = frames.filter((f) => f.opcode !== OPCODE.pong);
    expect(data.map((f) => [f.opcode, f.payload.length])).toEqual([
      [OPCODE.binary, small.length],
      [OPCODE.binary, 300],
      [OPCODE.binary, 70_000],
      [OPCODE.close, 2],
    ]);
    const pongs = frames.filter((f) => f.opcode === OPCODE.pong);
    expect(pongs.map((f) => f.payload.toString())).toEqual(["p1"]);
    expect(run.stderr).toBe("");
  });

  it("goes through HTTPS_PROXY with CONNECT and Basic auth, sending a placeholder when no key is set", async () => {
    const ws = await server();
    const p = await proxy();
    const env = { HTTPS_PROXY: p.url(`agent:${encodeURIComponent(PROXY_PASSWORD)}`) };
    const run = await tunnel(ws.port, env, [small]);
    expect(run.code).toBe(0);
    expect(run.stdout.equals(small)).toBe(true);
    expect(p.seen).toEqual([
      {
        target: `localhost:${ws.port}`,
        authorization: `Basic ${Buffer.from(`agent:${PROXY_PASSWORD}`).toString("base64")}`,
      },
    ]);
    expect(ws.sessions[0]?.headers["x-agent37-key"]).toBe("placeholder");
  });

  it("goes direct when NO_PROXY names the host, with the key from the env", async () => {
    const ws = await server();
    const p = await proxy();
    const env = { https_proxy: p.url(), NO_PROXY: "example.com, .LOCALHOST", AGENT37_API_KEY: KEY };
    const run = await tunnel(ws.port, env, [small]);
    expect(run.code).toBe(0);
    expect(p.seen).toEqual([]);
    expect(ws.sessions[0]?.headers["x-agent37-key"]).toBe(KEY);
  });

  it("reads the key from the variable --api-key-env names", async () => {
    const ws = await server();
    const stdin = new PassThrough();
    const { io } = capture();
    const args = ["agent37", "abc123def0", "--api-key-env", "MY_A37", "--host", "localhost"];
    const running = remoteTunnelCommand([...args, "--port", String(ws.port)], io, {
      stdin,
      stdout: new PassThrough(),
      env: { NODE_EXTRA_CA_CERTS: certificates.caFile, MY_A37: KEY, AGENT37_API_KEY: "other" },
    });
    setTimeout(() => stdin.end(), 100);
    expect(await running).toBe(0);
    expect(ws.sessions[0]?.headers["x-agent37-key"]).toBe(KEY);
  });

  it("exits 255 before any connection when there is neither a key nor a proxy", async () => {
    const ws = await server();
    const run = await tunnel(ws.port, {}, []);
    expect(run.code).toBe(255);
    expect(run.stderr).toContain("set AGENT37_API_KEY");
    expect(ws.sessions).toEqual([]);
  });

  it("exits 255 when the edge refuses the upgrade, printing no credential", async () => {
    const ws = await server({ refuse: "401 Unauthorized" });
    const p = await proxy();
    const env = {
      HTTPS_PROXY: p.url(`agent:${encodeURIComponent(PROXY_PASSWORD)}`),
      AGENT37_API_KEY: KEY,
    };
    const run = await tunnel(ws.port, env, []);
    expect(run.code).toBe(255);
    expect(run.stderr).toContain("refused: HTTP/1.1 401 Unauthorized");
    for (const secret of [KEY, PROXY_PASSWORD, "agent:"]) expect(run.stderr).not.toContain(secret);
  });

  it("exits 255 on a certificate it does not trust", async () => {
    const ws = await server();
    const run = await tunnel(ws.port, { AGENT37_API_KEY: KEY, NODE_EXTRA_CA_CERTS: "" }, []);
    expect(run.code).toBe(255);
    expect(run.stderr).toMatch(/certificate/i);
    expect(run.stderr).not.toContain(KEY);
  });

  it.each([
    [["agent37"]],
    [["boat", "abc123def0"]],
    [["agent37", "bad id"]],
    [["agent37", "abc123def0", "--api-key", KEY]],
    [["agent37", "abc123def0", "--api-key-env", "has space"]],
    [["agent37", "abc123def0", "--port", "0"]],
  ])("is a usage error for %j, echoing no argument", async (args) => {
    const { io, text } = capture();
    expect(await main(["remote-tunnel", ...args], io)).toBe(2);
    expect(text()).toMatch(/^usage: squeal remote-tunnel agent37 <instance-id>/);
    expect(text()).not.toContain(KEY);
  });

  it("is hidden from squeal's help", () => {
    const { io, text } = capture();
    main(["--help"], io);
    expect(text()).not.toContain("remote-tunnel");
  });

  it("runs as a ProxyCommand would: the CLI process bridges its own stdio, with the key only in its env", async () => {
    const ws = await server();
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const cli = resolve(import.meta.dirname, "../../src/cli/index.ts");
    const argv = [
      "--disable-warning=ExperimentalWarning",
      "--import",
      tsx,
      cli,
      "remote-tunnel",
      "agent37",
      "abc123def0",
      "--host",
      "localhost",
      "--port",
      String(ws.port),
    ];
    const child = spawn(process.execPath, argv, {
      env: {
        PATH: process.env.PATH,
        NODE_EXTRA_CA_CERTS: certificates.caFile,
        AGENT37_API_KEY: KEY,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
      if (Buffer.concat(out).length >= large.length) child.stdin.end();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.stdin.write(large);
    const code = await new Promise<number | null>((done) => child.on("close", done));
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(Buffer.concat(out).equals(large)).toBe(true);
    expect(argv.join(" ")).not.toContain(KEY);
    expect(ws.sessions[0]?.headers["x-agent37-key"]).toBe(KEY);
  }, 30_000);
});
