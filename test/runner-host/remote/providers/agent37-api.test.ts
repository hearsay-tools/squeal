import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { type AddressInfo, createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import {
  Agent37Api,
  Agent37Error,
} from "../../../../src/core/runner-host/remote/providers/agent37/api.js";
import { bypassesProxy } from "../../../../src/core/runner-host/remote/providers/agent37/net.js";
import { mockAgent37Api } from "./agent37-api-mock.js";
import { type Certificates, connectProxy, makeCertificates } from "./agent37-servers.js";

/*
 * Spec 026 D7.3.1 (row 026-15): the Agent37 API client over real TLS to a
 * local mock, trusted through `NODE_EXTRA_CA_CERTS`, directly or through
 * an HTTP `CONNECT` proxy; `NO_PROXY` bypasses it. No key reaches an error,
 * neither the one in the env nor one a proxy injected that this process
 * never saw: an error names the status and an allowlisted code only.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-agent37-api-"));
let certificates: Certificates;
beforeAll(() => {
  certificates = makeCertificates(scratch);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_api_key_5d1e";
/** A key an injecting proxy put on the wire: this process never had it. */
const INJECTED = "sk_live_injected_9c4b";
const PROXY_PASSWORD = "proxy-p@ss";
const SECRETS = [KEY, INJECTED, PROXY_PASSWORD];

/** An HTTPS server that answers every call `status` with `body(authorization)`. */
async function reflecting(status: number, body: (authorization: string) => unknown) {
  const server = createHttpsServer(
    { key: certificates.key, cert: certificates.cert },
    (request, response) => {
      const text = JSON.stringify(body(request.headers.authorization ?? ""));
      response.writeHead(status, { "Content-Type": "application/json" }).end(text);
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  onTestFinished(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  return `https://localhost:${(server.address() as AddressInfo).port}`;
}

/** A proxy that answers every request with `reply`, whatever it was asked. */
async function rawProxy(reply: string) {
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("data", () => socket.end(reply));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  onTestFinished(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const { port } = server.address() as AddressInfo;
  return `http://agent:${encodeURIComponent(PROXY_PASSWORD)}@127.0.0.1:${port}`;
}

/** The error `call` rejected with, checked to carry no secret anywhere a log could print. */
async function refusal(call: Promise<unknown>): Promise<Error> {
  const error = await call.then(
    () => expect.fail("the call succeeded"),
    (caught: unknown) => caught as Error,
  );
  const printed = [error.message, String(error), error.stack ?? "", JSON.stringify(error)];
  for (const secret of SECRETS) for (const text of printed) expect(text).not.toContain(secret);
  return error;
}

async function https() {
  const api = await mockAgent37Api(certificates);
  onTestFinished(() => api.close());
  return api;
}

async function proxy() {
  const p = await connectProxy();
  onTestFinished(() => p.close());
  return p;
}

const client = (baseUrl: string, env: NodeJS.ProcessEnv) =>
  new Agent37Api({
    baseUrl,
    keyEnv: "AGENT37_API_KEY",
    env: { NODE_EXTRA_CA_CERTS: certificates.caFile, ...env },
    retryMs: 5,
    retries: 3,
  });

describe("the Agent37 API client (row 026-15)", () => {
  it("calls over direct TLS with the key as a Bearer token", async () => {
    const api = await https();
    const a37 = client(api.url, { AGENT37_API_KEY: KEY });
    const made = await a37.create({
      template: "agent37-base",
      region: "eu",
      type: "vm",
      resources: { cpu: 4, memory: 8, disk: 10 },
      auto_sleep: true,
      idle_timeout_seconds: 600,
      name: "squeal-test",
    });
    expect(made.status).toBe("running");
    expect(await a37.inspect(made.id)).toEqual({ id: made.id, status: "running" });
    expect(await a37.inspect("nosuch")).toBeNull();
    expect(api.calls.map((c) => c.authorization)).toEqual([
      `Bearer ${KEY}`,
      `Bearer ${KEY}`,
      `Bearer ${KEY}`,
    ]);
  });

  it("goes through HTTPS_PROXY with a placeholder when no key is set", async () => {
    const api = await https();
    const p = await proxy();
    const a37 = client(api.url, { HTTPS_PROXY: p.url() });
    expect(await a37.inspect("nosuch")).toBeNull();
    expect(p.seen.map((s) => s.target)).toEqual([api.url.replace("https://", "")]);
    expect(api.calls[0]?.authorization).toBe("Bearer placeholder");
  });

  it("goes direct when NO_PROXY names the host", async () => {
    const api = await https();
    const p = await proxy();
    const a37 = client(api.url, {
      https_proxy: p.url(),
      no_proxy: "localhost",
      AGENT37_API_KEY: KEY,
    });
    expect(await a37.inspect("nosuch")).toBeNull();
    expect(p.seen).toEqual([]);
  });

  it("retries 409 try_again, then names the call that still failed without the key", async () => {
    const api = await https();
    const a37 = client(api.url, { AGENT37_API_KEY: KEY });
    api.instances.set("abc", "sleeping");
    api.tryAgain = 2;
    expect(await a37.start("abc")).toEqual({ id: "abc", status: "running" });
    api.tryAgain = 10;
    const failed = a37.start("abc");
    const error = await refusal(failed);
    expect(error.message).toBe("Agent37 POST /v1/instances/abc/start answered 409 (try_again)");
    expect(error).toMatchObject({ status: 409, code: "try_again" });
    expect(api.calls.filter((c) => c.path.endsWith("/start"))).toHaveLength(3 + 4);
  });

  it("treats a delete of a gone instance as done", async () => {
    const api = await https();
    const a37 = client(api.url, { AGENT37_API_KEY: KEY });
    api.instances.set("abc", "running");
    expect(await a37.remove("abc")).toBe(true);
    expect(await a37.remove("abc")).toBe(false);
  });

  it.each([
    ["the env's key", (auth: string) => auth],
    ["a key a proxy injected", () => `Bearer ${INJECTED}`],
  ])("keeps %s that the API reflects out of the error and its code", async (_, echo) => {
    const url = await reflecting(401, (auth) => ({
      error: { code: echo(auth), message: `Invalid key ${echo(auth)}` },
    }));
    const error = await refusal(client(url, { AGENT37_API_KEY: KEY }).inspect("abc"));
    expect(error).toBeInstanceOf(Agent37Error);
    expect(error.message).toBe("Agent37 GET /v1/instances/abc answered 401");
    expect(error).toMatchObject({ status: 401, code: null });
  });

  it("keeps an allowlisted code but never the message beside it", async () => {
    const url = await reflecting(403, (auth) => ({
      error: { code: "forbidden", message: `${auth} / ${INJECTED}` },
    }));
    const error = await refusal(client(url, { AGENT37_API_KEY: KEY }).sleep("abc"));
    expect(error.message).toBe("Agent37 POST /v1/instances/abc/sleep answered 403 (forbidden)");
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("names a proxy's CONNECT refusal by its status, never its reason, body or credential", async () => {
    const body = `denied ${INJECTED}`;
    const proxyUrl = await rawProxy(
      `HTTP/1.1 407 Bad ${INJECTED}\r\nProxy-Authenticate: Basic realm="${INJECTED}"\r\n` +
        `Content-Length: ${body.length}\r\n\r\n${body}`,
    );
    const a37 = client("https://localhost:9", { HTTPS_PROXY: proxyUrl, AGENT37_API_KEY: KEY });
    const error = await refusal(a37.inspect("abc"));
    const { port } = new URL(proxyUrl);
    expect(error.message).toBe(`proxy 127.0.0.1:${port} refused CONNECT localhost:9: 407`);
  });

  it("names a proxy that does not speak HTTP by an error code, never by what it sent", async () => {
    const proxyUrl = await rawProxy(`${INJECTED} ${KEY}\r\n\r\n`);
    const a37 = client("https://localhost:9", { HTTPS_PROXY: proxyUrl, AGENT37_API_KEY: KEY });
    const error = await refusal(a37.inspect("abc"));
    expect(error.message).toMatch(/^proxy 127\.0\.0\.1:\d+: [A-Z_]+$/);
  });

  it("rejects a certificate it does not trust", async () => {
    const api = await https();
    const a37 = client(api.url, { AGENT37_API_KEY: KEY, NODE_EXTRA_CA_CERTS: "" });
    await expect(a37.inspect("x")).rejects.toThrow(/certificate/i);
  });
});

describe("NO_PROXY matching (row 026-15)", () => {
  it.each([
    ["*", "a.agent37.app", true],
    ["agent37.app", "x-22022.agent37.app", true],
    [".agent37.app", "x-22022.agent37.app", true],
    ["*.agent37.app", "x-22022.agent37.app", true],
    ["AGENT37.APP", "x.agent37.app", true],
    ["agent37.app:443", "x.agent37.app", true],
    ["agent37.app:8443", "x.agent37.app", false],
    ["37.app", "x.agent37.app", false],
    ["example.com, other.org", "x.agent37.app", false],
  ])("NO_PROXY=%j for %s: %s", (list, host, bypass) => {
    expect(bypassesProxy(host, 443, { NO_PROXY: list })).toBe(bypass);
  });
});

describe("the Agent37 API client's instance fields (row 026-29)", () => {
  it("reads mount_path and template when the API sends them", async () => {
    const url = await reflecting(200, () => ({
      id: "i1",
      status: "running",
      mount_path: "/root",
      template: "agent37-ubuntu@2026.11.17a",
      url: "https://i1.agent37.app",
    }));
    expect(await client(url, { AGENT37_API_KEY: KEY }).inspect("i1")).toEqual({
      id: "i1",
      status: "running",
      mount_path: "/root",
      template: "agent37-ubuntu@2026.11.17a",
    });
  });

  it("leaves them out when absent or not strings", async () => {
    const absent = await reflecting(200, () => ({ id: "i2", status: "sleeping" }));
    const absentFound = await client(absent, { AGENT37_API_KEY: KEY }).inspect("i2");
    expect(absentFound).toEqual({ id: "i2", status: "sleeping" });
    expect(absentFound !== null && "mount_path" in absentFound).toBe(false);
    expect(absentFound !== null && "template" in absentFound).toBe(false);
    const odd = await reflecting(200, () => ({
      id: "i3",
      status: "running",
      mount_path: null,
      template: 5,
    }));
    expect(await client(odd, { AGENT37_API_KEY: KEY }).inspect("i3")).toEqual({
      id: "i3",
      status: "running",
    });
  });
});
