import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { Agent37Api } from "../../../../src/core/runner-host/remote/providers/agent37/api.js";
import { bypassesProxy } from "../../../../src/core/runner-host/remote/providers/agent37/net.js";
import { mockAgent37Api } from "./agent37-api-mock.js";
import { type Certificates, connectProxy, makeCertificates } from "./agent37-servers.js";

/*
 * Spec 026 D7.3.1 (row 026-15): the Agent37 API client over real TLS to a
 * local mock, trusted through `NODE_EXTRA_CA_CERTS`, directly or through
 * an HTTP `CONNECT` proxy; `NO_PROXY` bypasses it. No key reaches an error.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-agent37-api-"));
let certificates: Certificates;
beforeAll(() => {
  certificates = makeCertificates(scratch);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const KEY = "sk_test_api_key_5d1e";

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
    await expect(failed).rejects.toThrow(
      "Agent37 POST /v1/instances/abc/start answered 409 (try_again: Retry shortly.)",
    );
    await failed.catch((error: Error) => expect(error.message).not.toContain(KEY));
    expect(api.calls.filter((c) => c.path.endsWith("/start"))).toHaveLength(3 + 4);
  });

  it("treats a delete of a gone instance as done", async () => {
    const api = await https();
    const a37 = client(api.url, { AGENT37_API_KEY: KEY });
    api.instances.set("abc", "running");
    expect(await a37.remove("abc")).toBe(true);
    expect(await a37.remove("abc")).toBe(false);
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
