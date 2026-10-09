import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type {
  AbsolutePath,
  DaemonPhase,
  DaemonResponse,
  RevisionNumber,
  SyncAnswer,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Lessons, defect 30: `status --wait` asks the daemon for a reconciliation
 * pass and decides quiet at the revision the pass stored. The request is
 * answered at once, like `run-all`, and its revision is asked for after.
 */

const MATH: TestFileRef = { project: "", path: "test/math.test.ts" as never };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function handler(
  requestSync: NonNullable<HandlerContext["requestSync"]> | null,
  phase: DaemonPhase = "ready",
) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    phase: () => phase,
    requestFullSuite: () => new Promise(() => {}),
    ...(requestSync === null ? {} : { requestSync }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

/** Lets the handler's promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function requestId(response: DaemonResponse): string {
  if (!response.ok || response.type !== "sync") throw new Error(JSON.stringify(response));
  return response.requestId;
}

describe("the sync request (lessons, defect 30)", () => {
  it("parses sync and sync-status", () => {
    expect(parseRequest('{"type":"sync"}')).toEqual({ type: "sync" });
    expect(parseRequest('{"type":"sync","after":4}')).toEqual({ type: "sync", after: 4 });
    expect(parseRequest('{"type":"sync","after":-1}')).toBe('"after" must be a revision number');
    expect(parseRequest('{"type":"sync","after":"4"}')).toBe('"after" must be a revision number');
    expect(parseRequest('{"type":"sync-status","requestId":"r1"}')).toEqual({
      type: "sync-status",
      requestId: "r1",
    });
    expect(parseRequest('{"type":"sync-status"}')).toBe('"requestId" must be a string');
  });

  it("answers at once and reports the revision once the pass is stored", async () => {
    let store: (answer: SyncAnswer) => void = () => {};
    const handle = handler(() => new Promise((resolve) => (store = resolve)));

    const first = handle({ type: "sync" });
    expect(first).toMatchObject({ ok: true, type: "sync", revision: null, error: null });
    const id = requestId(first);
    expect(handle({ type: "sync-status", requestId: id })).toMatchObject({ revision: null });

    store({ revision: 7 as RevisionNumber, rekeyed: null });
    await settle();
    const answer = handle({ type: "sync-status", requestId: id });
    expect(answer).toMatchObject({ revision: 7, error: null });
    expect(answer).not.toHaveProperty("rekeyed");
  });

  // Task 001-186: the files the window's revisions re-keyed, which `status --wait` holds for.
  it("passes the window's start and answers with the files it re-keyed", async () => {
    const asked: (RevisionNumber | null)[] = [];
    const handle = handler((after) => {
      asked.push(after);
      return Promise.resolve({ revision: 9 as RevisionNumber, rekeyed: [MATH] });
    });

    const id = requestId(handle({ type: "sync", after: 6 as RevisionNumber }));
    await settle();

    expect(asked).toEqual([6]);
    expect(handle({ type: "sync-status", requestId: id })).toMatchObject({
      revision: 9,
      rekeyed: [MATH],
    });
  });

  it("reports a failed pass", async () => {
    const handle = handler(() =>
      Promise.reject(new Error("the daemon is not running a scheduler")),
    );

    const id = requestId(handle({ type: "sync" }));
    await settle();

    expect(handle({ type: "sync-status", requestId: id })).toMatchObject({
      revision: null,
      error: "the daemon is not running a scheduler",
    });
  });

  it("refuses when the daemon cannot sync or is stopping, and for an unknown id", () => {
    expect(handler(null)({ type: "sync" })).toMatchObject({
      ok: false,
      error: "this daemon cannot sync",
    });
    expect(handler(() => new Promise(() => {}), "stopping")({ type: "sync" })).toMatchObject({
      ok: false,
      error: "daemon is stopping",
    });
    expect(handler(null)({ type: "sync-status", requestId: "nope" })).toMatchObject({ ok: false });
  });
});

describe("sync through the front desk", () => {
  it("reaches the daemon's requestSync and answers sync-status", async () => {
    const dir = mkdtempSync("/tmp/sq-sync-");
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
        requestSlowSuite: () => new Promise(() => {}),
        requestSync: (after) => {
          calls++;
          return Promise.resolve({
            revision: 5 as RevisionNumber,
            rekeyed: after === null ? null : [MATH],
          });
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const ask = { type: "sync", after: 3 as RevisionNumber } as const;
    const id = requestId(await requestDaemon(socketPath, ask, 2_000));
    await settle();
    expect(calls).toBe(1);
    expect(
      await requestDaemon(socketPath, { type: "sync-status", requestId: id }, 2_000),
    ).toMatchObject({ type: "sync", revision: 5, error: null, rekeyed: [MATH] });
  });
});
