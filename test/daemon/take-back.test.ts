import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { DaemonResponse } from "../../src/core/types/daemon.js";

/*
 * Spec 023 D4.11 (row 023-34, T1): `status --at --run` sends `take-back`
 * with the covered-files ids of its narrow runs when its budget ends. The
 * daemon answers at once with a request id and hands the ids to the
 * scheduler; `take-back-status` answers what it did. One without it
 * answers an error, and the CLI keeps its old line.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const RESULT = { takenBack: 2, running: 1, kept: 0 };

function handler(requestTakeBack: NonNullable<HandlerContext["requestTakeBack"]> | null) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => "stopping",
    requestFullSuite: () => new Promise(() => {}),
    ...(requestTakeBack === null ? {} : { requestTakeBack }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

const idOf = (response: DaemonResponse) => ("requestId" in response ? response.requestId : "");

describe("the take-back request (row 023-34, T1)", () => {
  it("parses the calls' identities and the status's request id, and refuses anything else", () => {
    expect(parseRequest('{"type":"take-back","owners":["c1","c2"],"x":1}')).toEqual({
      type: "take-back",
      owners: ["c1", "c2"],
    });
    expect(parseRequest('{"type":"take-back","owners":[""]}')).toBe(
      '"owners" must be a list of non-empty strings',
    );
    expect(parseRequest('{"type":"take-back"}')).toBe(
      '"owners" must be a list of non-empty strings',
    );
    expect(parseRequest('{"type":"take-back-status","requestId":"r"}')).toEqual({
      type: "take-back-status",
      requestId: "r",
    });
    expect(parseRequest('{"type":"take-back-status"}')).toBe('"requestId" must be a string');
  });

  it("answers at once, then its status says what the scheduler did; a stopping daemon too", async () => {
    const calls: (readonly string[])[] = [];
    let done: (result: typeof RESULT) => void = () => {};
    const handle = handler((ids) => {
      calls.push(ids);
      return new Promise((resolve) => {
        done = resolve;
      });
    });
    const first = handle({ type: "take-back", owners: ["c1"] });
    expect(first).toMatchObject({ ok: true, type: "take-back", result: null, error: null });
    expect(calls).toEqual([["c1"]]);
    const status = { type: "take-back-status", requestId: idOf(first) } as const;
    expect(handle(status)).toMatchObject({ result: null });
    done(RESULT);
    await expect.poll(() => handle(status)).toMatchObject({ ok: true, result: RESULT });
    expect(handle({ type: "take-back-status", requestId: "nope" })).toMatchObject({
      ok: false,
      error: "unknown request id nope",
    });
  });

  it("refuses on a daemon that cannot take back", () => {
    expect(handler(null)({ type: "take-back", owners: ["c1"] })).toMatchObject({
      ok: false,
      error: "this daemon cannot take back",
    });
  });
});

describe("take-back through the front desk (T1)", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's requestTakeBack and answers its result $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-take-back-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const calls: (readonly string[])[] = [];
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
        requestSync: () => new Promise(() => {}),
        requestTakeBack: async (ids) => {
          calls.push(ids);
          return RESULT;
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const first = await requestDaemon(socketPath, { type: "take-back", owners: ["c1"] }, 2_000);
    expect(first).toMatchObject({ ok: true, type: "take-back" });
    const status = { type: "take-back-status", requestId: idOf(first) } as const;
    await expect
      .poll(() => requestDaemon(socketPath, status, 2_000))
      .toMatchObject({ ok: true, result: RESULT });
    expect(calls).toEqual([["c1"]]);
  });
});

describe("a narrow request's owner and lead (review wave-20 B1-B3)", () => {
  it("parse, and refuse anything else", () => {
    const line =
      '{"type":"run-group-paths","group":"tests","paths":["a"],"at":true,"owner":"o1","lead":true}';
    expect(parseRequest(line)).toEqual({
      type: "run-group-paths",
      group: "tests",
      paths: ["a"],
      at: true,
      owner: "o1",
      lead: true,
    });
    expect(parseRequest('{"type":"run-group-paths","group":"t","paths":["a"],"owner":""}')).toBe(
      '"owner" must be a non-empty string',
    );
    expect(parseRequest('{"type":"run-group-paths","group":"t","paths":["a"],"lead":false}')).toBe(
      '"lead" must be true when given',
    );
  });

  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reach the scheduler's narrow run $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-owner-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const asked: unknown[] = [];
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
        requestSync: () => new Promise(() => {}),
        requestGroup: (group, _held, paths, options) => {
          asked.push({ group, paths, options });
          return new Promise(() => {});
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    const request = {
      type: "run-group-paths",
      group: "tests",
      paths: ["test/a.test.ts"],
      owner: "o1",
      lead: true,
    } as const;
    expect(await requestDaemon(socketPath, request, 2_000)).toMatchObject({ ok: true });
    await expect
      .poll(() => asked)
      .toEqual([
        { group: "tests", paths: ["test/a.test.ts"], options: { owner: "o1", lead: true } },
      ]);
  });
});
