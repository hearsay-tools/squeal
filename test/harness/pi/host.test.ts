import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createDeliveryHost, type DeliveryHost } from "../../../src/harness/pi/host.js";

/*
 * Spec 009 D4: each handler posts one request to the worker and awaits it
 * against a deadline; a missed deadline, a dead worker and a throw are
 * silence, and the next request starts a fresh worker.
 */

/** A worker from inline source; `parentPort` and the posted `{ id, request }` are in scope. */
const inline = (onMessage: string) => () =>
  new Worker(
    `const { parentPort } = require("node:worker_threads");
     parentPort.on("message", ({ id, request }) => { ${onMessage} });`,
    { eval: true },
  );

const ECHO = inline(`parentPort.postMessage({ id, ok: true, answer: request.kind });`);
const STALL = inline(``);
const PING = { kind: "ping" } as const;

let hosts: DeliveryHost[] = [];
afterEach(() => {
  for (const host of hosts) host.stop();
  hosts = [];
});
function host(start: () => Worker): DeliveryHost {
  const h = createDeliveryHost(start);
  hosts.push(h);
  return h;
}

describe("DeliveryHost", () => {
  it("resolves the worker's answer", async () => {
    expect(await host(ECHO).call(PING, 2_000)).toBe("ping");
  });

  it("resolves null at the deadline when the worker never answers", async () => {
    const started = performance.now();
    expect(await host(STALL).call(PING, 200)).toBeNull();
    const ms = performance.now() - started;
    expect(ms).toBeGreaterThanOrEqual(195);
    expect(ms).toBeLessThan(1_000);
  });

  it("replaces a worker that missed its deadline", async () => {
    let starts = 0;
    // The first worker stalls, every later one answers.
    const h = host(() => (starts++ === 0 ? STALL() : ECHO()));
    expect(await h.call(PING, 100)).toBeNull();
    expect(await h.call(PING, 2_000)).toBe("ping");
    expect(starts).toBe(2);
  });

  it("is silent when the worker dies, and starts a fresh one for the next request", async () => {
    let starts = 0;
    const h = host(() => (starts++ === 0 ? inline(`process.exit(3);`)() : ECHO()));
    const started = performance.now();
    expect(await h.call(PING, 5_000)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await h.call(PING, 2_000)).toBe("ping");
    expect(starts).toBe(2);
  });

  it("is silent when the worker throws", async () => {
    let starts = 0;
    const h = host(() => (starts++ === 0 ? inline(`throw new Error("boom");`)() : ECHO()));
    expect(await h.call(PING, 5_000)).toBeNull();
    expect(await h.call(PING, 2_000)).toBe("ping");
  });

  it("is silent when the handler reports a failure", async () => {
    const h = host(inline(`parentPort.postMessage({ id, ok: false });`));
    expect(await h.call(PING, 2_000)).toBeNull();
  });

  it("answers concurrent requests by id", async () => {
    const h = host(
      inline(`setTimeout(() => parentPort.postMessage({ id, ok: true, answer: String(id) }),
                         id === 1 ? 50 : 0);`),
    );
    const [a, b] = await Promise.all([h.call(PING, 2_000), h.call(PING, 2_000)]);
    expect([a, b]).toEqual(["1", "2"]);
  });

  it("is silent after stop, and stop resolves what is pending", async () => {
    const h = host(STALL);
    const pending = h.call(PING, 10_000);
    h.stop();
    expect(await pending).toBeNull();
    expect(await h.call(PING, 2_000)).toBeNull();
  });

  it("is silent when the worker cannot start", async () => {
    const h = host(() => {
      throw new Error("no worker");
    });
    expect(await h.call(PING, 2_000)).toBeNull();
  });
});
