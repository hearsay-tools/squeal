import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import type { PiContext } from "../../../src/harness/pi/api.js";
import {
  EVENT_DEADLINE_MS,
  SHUTDOWN_DEADLINE_MS,
  squealExtension,
} from "../../../src/harness/pi/extension.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Spec 009 D2, D3 and D4 at the extension: one registration per session id,
 * the header queued for the next prompt, unregistration at shutdown, silence
 * after it, and no handler that throws or outlasts its deadline.
 */

const KINDS = ["start", "shutdown", "boundary", "ping"] as const;

/**
 * A worker standing in for the delivery worker: counts each request kind in
 * shared memory and answers a start with `header`, unless `stall`.
 */
function fakeWorker(options: { stall?: boolean } = {}) {
  const counts = new Int32Array(new SharedArrayBuffer(4 * KINDS.length));
  let starts = 0;
  const start = () => {
    starts++;
    return new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       const counts = new Int32Array(workerData.counts);
       const kinds = ${JSON.stringify(KINDS)};
       parentPort.on("message", ({ id, request }) => {
         Atomics.add(counts, kinds.indexOf(request.kind), 1);
         if (${options.stall === true}) return;
         parentPort.postMessage({ id, ok: true, text: request.kind === "start" ? "header" : null });
       });`,
      { eval: true, workerData: { counts: counts.buffer } },
    );
  };
  const count = (kind: (typeof KINDS)[number]) => Atomics.load(counts, KINDS.indexOf(kind));
  return { start, count, starts: () => starts };
}

const SESSION = "019a0000-0000-7000-8000-000000000001";

function loaded(worker = fakeWorker()) {
  const pi = stubPi();
  squealExtension(worker.start)(pi.api);
  return { pi, worker, ctx: piContext(SESSION) };
}

describe("the Pi extension's session events", () => {
  it("starts no worker until a session starts", () => {
    const { worker } = loaded();
    expect(worker.starts()).toBe(0);
  });

  it("registers at session_start and queues the header for the next prompt", async () => {
    const { pi, worker, ctx } = loaded();
    await pi.start("startup", ctx);
    expect(worker.count("start")).toBe(1);
    expect(pi.sent).toEqual([
      {
        message: { customType: "squeal", content: "header", display: true },
        options: { deliverAs: "nextTurn" },
      },
    ]);
    await pi.shutdown("quit", ctx);
  });

  it("registers once when session_start arrives twice for one session", async () => {
    const { pi, worker, ctx } = loaded();
    await pi.start("new", ctx);
    await pi.start("new", ctx);
    expect(worker.count("start")).toBe(1);
    expect(pi.sent).toHaveLength(1);
    await pi.shutdown("quit", ctx);
  });

  it.each(["quit", "new", "resume", "fork"] as const)(
    "unregisters the session at session_shutdown(%s), then is silent",
    async (reason) => {
      const { pi, worker, ctx } = loaded();
      await pi.start("startup", ctx);
      await pi.shutdown(reason, ctx);
      expect(worker.count("shutdown")).toBe(1);
      await pi.start("startup", piContext("019a0000-0000-7000-8000-000000000002"));
      await pi.shutdown("quit", ctx);
      expect(worker.count("start")).toBe(1);
      expect(worker.count("shutdown")).toBe(1);
      expect(pi.sent).toHaveLength(1);
    },
  );

  it("leaves the session registered at session_shutdown(reload), for the next instance", async () => {
    const { pi, worker, ctx } = loaded();
    await pi.start("startup", ctx);
    await pi.shutdown("reload", ctx);
    expect(worker.count("shutdown")).toBe(0);
  });

  it("starts no worker for a shutdown without a start", async () => {
    const { pi, worker, ctx } = loaded();
    await pi.shutdown("quit", ctx);
    expect(worker.starts()).toBe(0);
  });

  it("is silent on a stale context", async () => {
    const { pi, worker } = loaded();
    const stale: PiContext = {
      mode: "rpc",
      cwd: "/",
      sessionManager: {
        getSessionId: () => {
          throw new Error("This extension ctx is stale after session replacement or reload.");
        },
      },
    };
    await expect(pi.start("startup", stale)).resolves.toBeUndefined();
    await expect(pi.shutdown("quit", stale)).resolves.toBeUndefined();
    expect(worker.starts()).toBe(0);
  });

  it("is silent when the worker cannot start", async () => {
    const pi = stubPi();
    squealExtension(() => {
      throw new Error("no worker");
    })(pi.api);
    await expect(pi.start("startup", piContext(SESSION))).resolves.toBeUndefined();
    expect(pi.sent).toEqual([]);
  });

  it("returns silence within the deadline when the worker stalls", async () => {
    const { pi, worker, ctx } = loaded(fakeWorker({ stall: true }));
    const started = performance.now();
    await pi.start("startup", ctx);
    const ms = performance.now() - started;
    expect(ms).toBeGreaterThanOrEqual(EVENT_DEADLINE_MS - 5);
    expect(ms).toBeLessThan(EVENT_DEADLINE_MS + 500);
    expect(worker.count("start")).toBe(1);
    expect(pi.sent).toEqual([]);
  });

  it("bounds session_shutdown by its deadline when the worker stalls", async () => {
    const { pi, worker, ctx } = loaded(fakeWorker({ stall: true }));
    await pi.start("startup", ctx);
    const started = performance.now();
    await pi.shutdown("quit", ctx);
    const ms = performance.now() - started;
    // The stalled start's worker was replaced: the shutdown went to a fresh one.
    expect(worker.starts()).toBe(2);
    expect(worker.count("shutdown")).toBe(1);
    expect(ms).toBeGreaterThanOrEqual(SHUTDOWN_DEADLINE_MS - 5);
    expect(ms).toBeLessThan(SHUTDOWN_DEADLINE_MS + 500);
  }, 10_000);
});
