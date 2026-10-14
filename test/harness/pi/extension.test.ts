import { describe, expect, it } from "vitest";
import {
  EVENT_DEADLINE_MS,
  SHUTDOWN_DEADLINE_MS,
  squealExtension,
} from "../../../src/harness/pi/extension.js";
import { fakeWorker } from "./fake-worker.js";
import { piContext, stubPi } from "./stub-pi.js";

/*
 * Spec 009 D2, D3 and D4 at the extension: one registration per session id,
 * the header queued for the next prompt, unregistration at shutdown, silence
 * after it, and no handler that throws or outlasts its deadline.
 */

/** The fake delivery worker of these tests: a start answers `header`. */
const headerWorker = (options: { stall?: boolean } = {}) =>
  fakeWorker({
    answers: { start: "header" },
    ...(options.stall ? { stall: ["start", "shutdown"] } : {}),
  });

const SESSION = "019a0000-0000-7000-8000-000000000001";

function loaded(fake = headerWorker()) {
  const pi = stubPi();
  squealExtension(fake.start)(pi.api);
  return { pi, worker: fake, ctx: piContext(SESSION) };
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
    const stale = piContext(() => {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    });
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
    const { pi, worker, ctx } = loaded(headerWorker({ stall: true }));
    const started = performance.now();
    await pi.start("startup", ctx);
    const ms = performance.now() - started;
    expect(ms).toBeGreaterThanOrEqual(EVENT_DEADLINE_MS - 5);
    expect(ms).toBeLessThan(EVENT_DEADLINE_MS + 500);
    expect(worker.count("start")).toBe(1);
    expect(pi.sent).toEqual([]);
  });

  it("bounds session_shutdown by its deadline when the worker stalls", async () => {
    const { pi, worker, ctx } = loaded(headerWorker({ stall: true }));
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
