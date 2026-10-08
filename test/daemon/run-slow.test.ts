import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { requestSlowSuite, SLOW_NOT_SUPPORTED } from "../../src/core/daemon/run-slow.js";
import type {
  AbsolutePath,
  DaemonResponse,
  RevisionNumber,
  Scheduler,
} from "../../src/core/types/index.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Requested = { readonly revision: RevisionNumber; readonly queued: number };

function handler(
  requestSlowSuite: NonNullable<HandlerContext["requestSlowSuite"]> | null,
  phase = "ready" as const,
) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    phase: () => phase,
    requestFullSuite: () => new Promise(() => {}),
    ...(requestSlowSuite === null ? {} : { requestSlowSuite }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

/** Lets the handler's promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function requestId(response: DaemonResponse): string {
  if (!response.ok || response.type !== "run-slow") throw new Error(JSON.stringify(response));
  return response.requestId;
}

describe("the run-slow request (spec 004 D2, explicit trigger)", () => {
  it("parses run-slow and run-slow-status", () => {
    expect(parseRequest('{"type":"run-slow"}')).toEqual({ type: "run-slow" });
    expect(parseRequest('{"type":"run-slow-status","requestId":"r1"}')).toEqual({
      type: "run-slow-status",
      requestId: "r1",
    });
    expect(parseRequest('{"type":"run-slow-status"}')).toBe('"requestId" must be a string');
  });

  it("answers at once, hands the request to the scheduler, and reports what it queued", async () => {
    let calls = 0;
    let resolve: (requested: Requested) => void = () => {};
    const handle = handler(() => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    });
    const first = handle({ type: "run-slow" });
    expect(first).toMatchObject({ ok: true, type: "run-slow", requested: null, error: null });
    expect(calls).toBe(1);
    const id = requestId(first);
    expect(handle({ type: "run-slow-status", requestId: id })).toMatchObject({ requested: null });

    resolve({ revision: 7 as RevisionNumber, queued: 2 });
    await settle();
    expect(handle({ type: "run-slow-status", requestId: id })).toMatchObject({
      ok: true,
      type: "run-slow",
      requestId: id,
      requested: { revision: 7, queued: 2 },
      error: null,
    });
  });

  it("reports the scheduler's refusal as the request's error", async () => {
    const handle = handler(() => Promise.reject(new Error(SLOW_NOT_SUPPORTED)));
    const id = requestId(handle({ type: "run-slow" }));
    await settle();
    expect(handle({ type: "run-slow-status", requestId: id })).toMatchObject({
      requested: null,
      error: SLOW_NOT_SUPPORTED,
    });
  });

  it("answers not supported when the daemon has no slow tier", async () => {
    const handle = handler(null);
    const id = requestId(handle({ type: "run-slow" }));
    await settle();
    expect(handle({ type: "run-slow-status", requestId: id })).toMatchObject({
      error: SLOW_NOT_SUPPORTED,
    });
  });

  it("refuses while stopping and answers an unknown request id with an error", () => {
    const handle = handler(() => new Promise(() => {}), "stopping" as never);
    expect(handle({ type: "run-slow" })).toMatchObject({ ok: false, error: "daemon is stopping" });
    expect(handle({ type: "run-slow-status", requestId: "nope" })).toMatchObject({
      ok: false,
      error: "unknown request id nope",
    });
  });
});

describe("requestSlowSuite on the daemon's scheduler", () => {
  const scheduler = {} as Scheduler;

  it("calls the scheduler's requestSlowSuite when it has one", async () => {
    let calls = 0;
    const stub = Object.assign(Object.create(scheduler) as Scheduler, {
      requestSlowSuite: () => {
        calls++;
        return Promise.resolve({ revision: 4 as RevisionNumber, queued: 1 });
      },
    });
    await expect(requestSlowSuite(stub)).resolves.toEqual({ revision: 4, queued: 1 });
    expect(calls).toBe(1);
  });

  it("says the daemon does not support it when the scheduler has none", async () => {
    await expect(requestSlowSuite(scheduler)).rejects.toThrow(SLOW_NOT_SUPPORTED);
  });
});

describe("run-slow through the front desk", () => {
  it("reaches the daemon's requestSlowSuite and answers run-slow-status", async () => {
    const dir = mkdtempSync("/tmp/sq-slow-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    let calls = 0;
    const desk = await prepareFrontDesk().open(
      {
        socketPath,
        worktreeId: "0123456789abcdef" as never,
        root: "/",
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
      },
      {
        onActivity: () => {},
        requestFullSuite: () => new Promise(() => {}),
        requestSlowSuite: () => {
          calls++;
          return Promise.resolve({ revision: 3 as RevisionNumber, queued: 0 });
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const id = requestId(await requestDaemon(socketPath, { type: "run-slow" }, 2_000));
    await settle();
    expect(calls).toBe(1);
    expect(
      await requestDaemon(socketPath, { type: "run-slow-status", requestId: id }, 2_000),
    ).toMatchObject({ requested: { revision: 3, queued: 0 }, error: null });
  });
});
