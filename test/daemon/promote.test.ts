import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { AbsolutePath, TestFileRef } from "../../src/core/types/index.js";

/*
 * Spec 011 C15 (task 011-11): a named wait sends `promote` with the test
 * files its paths select by themselves and what is left of the wait. The
 * daemon answers at once and hands them to the scheduler; one without it
 * answers an error, and the wait reads only.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const Z: TestFileRef = { project: "", path: "test/z.test.ts" };

function handler(requestPromotion: NonNullable<HandlerContext["requestPromotion"]> | null) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => "ready",
    requestFullSuite: () => new Promise(() => {}),
    ...(requestPromotion === null ? {} : { requestPromotion }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

describe("the promote request (spec 011 C15)", () => {
  it("parses the test files and the time left, and refuses anything else", () => {
    const line = JSON.stringify({ type: "promote", testFiles: [{ ...Z, extra: 1 }], withinMs: 5 });
    expect(parseRequest(line)).toEqual({ type: "promote", testFiles: [Z], withinMs: 5 });
    expect(parseRequest('{"type":"promote","testFiles":[{"path":"a"}],"withinMs":5}')).toBe(
      '"testFiles" must be a list of { project, path } strings',
    );
    expect(parseRequest('{"type":"promote","testFiles":[],"withinMs":-1}')).toBe(
      '"withinMs" must be a number of milliseconds',
    );
    expect(parseRequest('{"type":"promote","testFiles":[]}')).toBe(
      '"withinMs" must be a number of milliseconds',
    );
  });

  it("answers at once and hands the files to the scheduler", () => {
    const calls: [readonly TestFileRef[], number][] = [];
    const handle = handler((files, withinMs) => {
      calls.push([files, withinMs]);
      return new Promise(() => {});
    });
    expect(handle({ type: "promote", testFiles: [Z], withinMs: 60_000 })).toMatchObject({
      ok: true,
      type: "promote",
    });
    expect(calls).toEqual([[[Z], 60_000]]);
  });

  it("refuses on a daemon that cannot promote", () => {
    expect(handler(null)({ type: "promote", testFiles: [Z], withinMs: 1 })).toMatchObject({
      ok: false,
      error: "this daemon cannot promote",
    });
  });
});

describe("promote through the front desk", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's requestPromotion $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-promote-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const calls: [readonly TestFileRef[], number][] = [];
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
        requestPromotion: async (files, withinMs) => {
          calls.push([files, withinMs]);
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const request = { type: "promote", testFiles: [Z], withinMs: 30_000 } as const;
    expect(await requestDaemon(socketPath, request, 2_000)).toMatchObject({
      ok: true,
      type: "promote",
    });
    await expect.poll(() => calls).toEqual([[[Z], 30_000]]);
  });
});
