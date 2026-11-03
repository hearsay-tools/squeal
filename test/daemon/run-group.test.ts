import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { type DeskEvents, prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import {
  GROUP_NOT_SUPPORTED,
  requestGroup,
  requestGroupRun,
} from "../../src/core/daemon/run-group.js";
import { createDaemonServer } from "../../src/core/daemon/server.js";
import type {
  AbsolutePath,
  DaemonResponse,
  RevisionNumber,
  Scheduler,
} from "../../src/core/types/index.js";

/* Spec 019 D6, row 019-15: the `run-group` request from the socket to `Scheduler.requestGroup`. */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Requested = { readonly revision: RevisionNumber; readonly queued: number } | null;

function handler(
  requestGroup: NonNullable<HandlerContext["requestGroup"]> | null,
  phase = "ready" as const,
) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => phase,
    requestFullSuite: () => new Promise(() => {}),
    requestSlowSuite: () => Promise.reject(new Error("run-group must not call requestSlowSuite")),
    ...(requestGroup === null ? {} : { requestGroup }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

/** Lets the handler's promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function requestId(response: DaemonResponse | null): string {
  if (response === null || !response.ok || response.type !== "run-group") {
    throw new Error(JSON.stringify(response));
  }
  return response.requestId;
}

function tempSocket(): AbsolutePath {
  const dir = mkdtempSync("/tmp/sq-group-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "d.sock") as AbsolutePath;
}

describe("the run-group request (spec 019 D6)", () => {
  it("parses run-group with its group and run-group-status", () => {
    expect(parseRequest('{"type":"run-group","group":"e2e"}')).toEqual({
      type: "run-group",
      group: "e2e",
    });
    expect(parseRequest('{"type":"run-group","group":""}')).toBe(
      '"group" must be a non-empty string',
    );
    expect(parseRequest('{"type":"run-group"}')).toBe('"group" must be a non-empty string');
    expect(parseRequest('{"type":"run-group-status","requestId":"r1"}')).toEqual({
      type: "run-group-status",
      requestId: "r1",
    });
    expect(parseRequest('{"type":"run-group-status"}')).toBe('"requestId" must be a string');
  });

  it("answers at once, hands the group to the scheduler, and reports what it queued", async () => {
    const asked: string[] = [];
    let resolve: (requested: Requested) => void = () => {};
    const handle = handler((group) => {
      asked.push(group);
      return new Promise((r) => {
        resolve = r;
      });
    });
    const first = handle({ type: "run-group", group: "e2e" });
    expect(first).toMatchObject({
      ok: true,
      type: "run-group",
      group: "e2e",
      requested: null,
      unknown: false,
      error: null,
    });
    expect(asked).toEqual(["e2e"]);
    const id = requestId(first);
    expect(handle({ type: "run-group-status", requestId: id })).toMatchObject({ requested: null });

    resolve({ revision: 7 as RevisionNumber, queued: 2 });
    await settle();
    expect(handle({ type: "run-group-status", requestId: id })).toEqual({
      schemaVersion: 1,
      ok: true,
      type: "run-group",
      requestId: id,
      group: "e2e",
      requested: { revision: 7, queued: 2 },
      unknown: false,
      error: null,
    });
  });

  it("says a group the policy in force does not have is unknown", async () => {
    const handle = handler(() => Promise.resolve(null));
    const id = requestId(handle({ type: "run-group", group: "nope" }));
    await settle();
    expect(handle({ type: "run-group-status", requestId: id })).toMatchObject({
      group: "nope",
      requested: null,
      unknown: true,
      error: null,
    });
  });

  it("answers not supported when the daemon cannot run groups", async () => {
    const handle = handler(null);
    const id = requestId(handle({ type: "run-group", group: "e2e" }));
    await settle();
    expect(handle({ type: "run-group-status", requestId: id })).toMatchObject({
      unknown: false,
      error: GROUP_NOT_SUPPORTED,
    });
  });

  it("refuses while stopping and answers an unknown request id with an error", () => {
    const handle = handler(() => new Promise(() => {}), "stopping" as never);
    expect(handle({ type: "run-group", group: "e2e" })).toMatchObject({
      ok: false,
      error: "daemon is stopping",
    });
    expect(handle({ type: "run-group-status", requestId: "nope" })).toMatchObject({
      ok: false,
      error: "unknown request id nope",
    });
  });
});

describe("requestGroup on the daemon's scheduler", () => {
  const scheduler = {} as Scheduler;

  it("calls the scheduler's requestGroup with the group", async () => {
    const asked: string[] = [];
    const stub = Object.assign(Object.create(scheduler) as Scheduler, {
      requestGroup(this: Scheduler, group: string) {
        asked.push(group);
        expect(this).toBe(stub);
        return Promise.resolve(
          group === "e2e" ? { revision: 4 as RevisionNumber, queued: 1 } : null,
        );
      },
    });
    await expect(requestGroup(stub, "e2e")).resolves.toEqual({ revision: 4, queued: 1 });
    await expect(requestGroup(stub, "nope")).resolves.toBeNull();
    expect(asked).toEqual(["e2e", "nope"]);
  });

  it("says the daemon does not support it when the scheduler has none", async () => {
    await expect(requestGroup(scheduler, "e2e")).rejects.toThrow(GROUP_NOT_SUPPORTED);
  });
});

describe("run-group through the front desk", () => {
  const worker = {
    script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
    execArgv: [
      "--disable-warning=ExperimentalWarning",
      "--import",
      fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
    ],
  };

  async function open(inWorker: boolean, requestGroup?: DeskEvents["requestGroup"]) {
    const socketPath = tempSocket();
    const desk = await prepareFrontDesk(inWorker ? worker : null).open(
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
        ...(requestGroup === undefined ? {} : { requestGroup }),
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    return socketPath;
  }

  /** The request's state once the scheduler answered it. */
  async function answered(socketPath: AbsolutePath, group: string) {
    const id = requestId(await requestDaemon(socketPath, { type: "run-group", group }, 2_000));
    for (;;) {
      const state = await requestDaemon(
        socketPath,
        { type: "run-group-status", requestId: id },
        2_000,
      );
      if (!state.ok || state.type !== "run-group") throw new Error(JSON.stringify(state));
      if (state.requested !== null || state.unknown || state.error !== null) return state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  for (const inWorker of [false, true]) {
    const where = inWorker ? "in its worker thread" : "on the main thread";

    it(`reaches the daemon's requestGroup ${where}, a known and an unknown group`, async () => {
      const asked: string[] = [];
      const socketPath = await open(inWorker, (group) => {
        asked.push(group);
        return Promise.resolve(
          group === "e2e" ? { revision: 3 as RevisionNumber, queued: 2 } : null,
        );
      });
      expect(await answered(socketPath, "e2e")).toMatchObject({
        group: "e2e",
        requested: { revision: 3, queued: 2 },
        unknown: false,
        error: null,
      });
      expect(await answered(socketPath, "nope")).toMatchObject({
        group: "nope",
        requested: null,
        unknown: true,
        error: null,
      });
      expect(asked).toEqual(["e2e", "nope"]);
    });

    it(`answers not supported ${where} when the daemon gives no requestGroup`, async () => {
      const socketPath = await open(inWorker);
      expect(await answered(socketPath, "e2e")).toMatchObject({
        requested: null,
        unknown: false,
        error: GROUP_NOT_SUPPORTED,
      });
    });
  }
});

describe("requestGroupRun, the client of Stop's request (row 019-14)", () => {
  it("sends run-group for the group and returns the daemon's first answer", async () => {
    const asked: string[] = [];
    const handle = handler((group) => {
      asked.push(group);
      return new Promise(() => {});
    });
    const socketPath = tempSocket();
    const server = await createDaemonServer(socketPath, handle);
    cleanups.push(() => server.close());
    expect(await requestGroupRun(socketPath, "e2e")).toMatchObject({
      ok: true,
      type: "run-group",
      group: "e2e",
      requested: null,
    });
    expect(asked).toEqual(["e2e"]);
  });

  it("returns an older daemon's unknown-request answer as it is", async () => {
    const socketPath = tempSocket();
    const server = await createDaemonServer(socketPath, () => ({
      schemaVersion: 1,
      ok: false,
      error: 'unknown request type "run-group"',
    }));
    cleanups.push(() => server.close());
    expect(await requestGroupRun(socketPath, "e2e")).toEqual({
      schemaVersion: 1,
      ok: false,
      error: 'unknown request type "run-group"',
    });
  });

  it("returns null without a daemon, and never rejects", async () => {
    await expect(requestGroupRun(tempSocket(), "e2e", 200)).resolves.toBeNull();
  });
});
