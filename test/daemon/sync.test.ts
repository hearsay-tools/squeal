import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type {
  AbsolutePath,
  DaemonPhase,
  DaemonResponse,
  EpochMs,
  RekeyedTestFile,
  RevisionNumber,
  SyncAnswer,
} from "../../src/core/types/index.js";

/*
 * Lessons, defect 30: `status --wait` asks the daemon for a reconciliation
 * pass and decides quiet at the revision the pass stored. The request is
 * answered at once, like `run-all`, and its revision is asked for after.
 */

const MATH: RekeyedTestFile = {
  testFile: { project: "", path: "test/math.test.ts" as never },
  revision: 8 as RevisionNumber,
};

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
    expect(parseRequest('{"type":"sync","after":4,"resolvedSince":1700}')).toEqual({
      type: "sync",
      after: 4,
      resolvedSince: 1700,
    });
    expect(parseRequest('{"type":"sync","after":4,"resolvedSince":"x"}')).toBe(
      '"resolvedSince" must be a time',
    );
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

  // Tasks 001-186, 001-196: the files the window's revisions re-keyed, which `status --wait` holds for.
  it("passes the window's start and answers with the files it re-keyed", async () => {
    const asked: [RevisionNumber | null, EpochMs | null][] = [];
    const handle = handler((after, resolvedSince) => {
      asked.push([after, resolvedSince]);
      return Promise.resolve({ revision: 9 as RevisionNumber, rekeyed: [MATH] });
    });

    const id = requestId(handle({ type: "sync", after: 6 as RevisionNumber, resolvedSince: 1700 }));
    requestId(handle({ type: "sync", after: 6 as RevisionNumber }));
    await settle();

    expect(asked).toEqual([
      [6, 1700],
      [6, null],
    ]);
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
    let since: EpochMs | null = null;
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
        requestSync: (after, resolvedSince) => {
          calls++;
          since = resolvedSince;
          return Promise.resolve({
            revision: 5 as RevisionNumber,
            rekeyed: after === null ? null : [MATH],
          });
        },
        forgetSync: () => {},
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const ask = { type: "sync", after: 3 as RevisionNumber, resolvedSince: 1700 } as const;
    const id = requestId(await requestDaemon(socketPath, ask, 2_000));
    await settle();
    expect(calls).toBe(1);
    expect(since).toBe(1700);
    expect(
      await requestDaemon(socketPath, { type: "sync-status", requestId: id }, 2_000),
    ).toMatchObject({ type: "sync", revision: 5, error: null, rekeyed: [MATH] });
  });
});

/*
 * Review wave-13r B2 (task 001-226): the socket remembers 32 sync requests,
 * and the main thread hears which it drops, by the id the request was
 * answered with, so their answers' holds are released at once.
 */
describe("a sync request the socket drops", () => {
  it("is forgotten on the main thread by its id, once each, the others never", async () => {
    const forgotten: string[] = [];
    const asked: string[] = [];
    const handle = createHandlers({
      worktreeId: "0123456789abcdef" as never,
      root: "/" as never,
      squealVersion: "0.0.0-test",
      startedAt: 1 as never,
      phase: () => "ready",
      requestFullSuite: () => new Promise(() => {}),
      requestSync: (_after, _since, id) => {
        asked.push(id);
        return new Promise(() => {});
      },
      forgetSync: (id) => forgotten.push(id),
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
    });
    const ids: string[] = [];
    for (let n = 0; n < 40; n += 1) {
      ids.push(requestId(handle({ type: "sync", after: 0 as RevisionNumber, resolvedSince: 1 })));
    }
    expect(asked).toEqual(ids);
    expect(forgotten).toEqual(ids.slice(0, 8));
    expect(handle({ type: "sync-status", requestId: ids[7] ?? "" })).toMatchObject({ ok: false });
    expect(handle({ type: "sync-status", requestId: ids[8] ?? "" })).toMatchObject({ ok: true });
    // Other requests' drops forget no sync.
    for (let n = 0; n < 40; n += 1) handle({ type: "run-all" });
    expect(forgotten).toHaveLength(8);
  });

  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's forgetSync through the front desk $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-sync-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const asked: string[] = [];
    const forgotten: string[] = [];
    const prepared = prepareFrontDesk(
      worker
        ? {
            script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
            execArgv: [
              "--disable-warning=ExperimentalWarning",
              "--import",
              fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
            ],
          }
        : null,
    );
    const desk = await prepared.open(
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
        requestSync: (_after, _since, id) => {
          asked.push(id);
          return new Promise(() => {});
        },
        forgetSync: (id) => forgotten.push(id),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const ask = { type: "sync", after: 3 as RevisionNumber, resolvedSince: 1700 } as const;
    const ids: string[] = [];
    for (let n = 0; n < 33; n += 1)
      ids.push(requestId(await requestDaemon(socketPath, ask, 2_000)));
    await expect.poll(() => asked).toEqual(ids);
    await expect.poll(() => forgotten).toEqual([ids[0]]);
  });
});
