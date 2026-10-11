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
  RevisionNumber,
  SyncAnswer,
} from "../../src/core/types/index.js";

/*
 * Lessons, defect 30: `status --wait` asks the daemon for a reconciliation
 * pass and decides quiet at the revision the pass stored. The request is
 * answered at once, like `run-all`, and its revision is asked for after.
 * The files the wait holds for are the store's (task 001-258): the answer
 * says the daemon records them (`moves`), and names none.
 */

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
    token: "t",
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
  it("parses sync and sync-status, an older CLI's window fields ignored", () => {
    expect(parseRequest('{"type":"sync"}')).toEqual({ type: "sync" });
    expect(parseRequest('{"type":"sync","after":4}')).toEqual({ type: "sync" });
    expect(parseRequest('{"type":"sync","after":4,"resolvedSince":1700}')).toEqual({
      type: "sync",
    });
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

    store({ revision: 7 as RevisionNumber });
    await settle();
    const answer = handle({ type: "sync-status", requestId: id });
    // The incarnation its registration names, which its ledger names the moves' writer (001-268).
    expect(answer).toMatchObject({
      revision: 7,
      error: null,
      moves: true,
      incarnation: "0.0.0-test@1#t",
    });
    // An older CLI that asked with `after` takes its path for a daemon before task 001-186.
    expect(answer).not.toHaveProperty("rekeyed");
  });

  it("remembers the latest 32 requests, which nothing else holds", async () => {
    let asked = 0;
    const handle = handler(() => {
      asked += 1;
      return Promise.resolve({ revision: 3 as RevisionNumber });
    });

    const ids = Array.from({ length: 40 }, () => requestId(handle({ type: "sync" })));
    await settle();

    expect(asked).toBe(40);
    expect(handle({ type: "sync-status", requestId: ids[7] ?? "" })).toMatchObject({ ok: false });
    expect(handle({ type: "sync-status", requestId: ids[8] ?? "" })).toMatchObject({
      ok: true,
      revision: 3,
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
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's requestSync $name and answers sync-status", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-sync-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    let calls = 0;
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
        token: "t",
      },
      {
        onActivity: () => {},
        requestFullSuite: () => new Promise(() => {}),
        requestSlowSuite: () => new Promise(() => {}),
        requestSync: () => {
          calls++;
          return Promise.resolve({ revision: 5 as RevisionNumber });
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    // As an older CLI asks: its window fields are ignored.
    const ask = { type: "sync", after: 3, resolvedSince: 1700 } as never;
    const id = requestId(await requestDaemon(socketPath, ask, 2_000));
    await expect.poll(() => calls).toBe(1);
    await expect
      .poll(() => requestDaemon(socketPath, { type: "sync-status", requestId: id }, 2_000))
      .toMatchObject({ type: "sync", revision: 5, error: null, moves: true });
    expect(
      await requestDaemon(socketPath, { type: "sync-status", requestId: id }, 2_000),
    ).not.toHaveProperty("rekeyed");
  });
});
