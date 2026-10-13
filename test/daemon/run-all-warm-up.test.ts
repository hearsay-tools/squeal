import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { AbsolutePath, FullSuiteRequest } from "../../src/core/types/index.js";

/*
 * Task 001-307: a `run-all` request takes an optional `observeIgnored`, a
 * setup warm-up, and every hop to the scheduler carries it; a request
 * without it reaches the scheduler as before.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the run-all request's observeIgnored (task 001-307)", () => {
  it("parses it, and rejects a value that is not true or false", () => {
    expect(parseRequest('{"type":"run-all","observeIgnored":true}')).toEqual({
      type: "run-all",
      force: false,
      observeIgnored: true,
    });
    expect(parseRequest('{"type":"run-all","force":true}')).toEqual({
      type: "run-all",
      force: true,
    });
    expect(parseRequest('{"type":"run-all","observeIgnored":false}')).toEqual({
      type: "run-all",
      force: false,
    });
    expect(parseRequest('{"type":"run-all","observeIgnored":"yes"}')).toBe(
      '"observeIgnored" must be true or false',
    );
  });

  it("reaches the scheduler's request through the handler", () => {
    const asked: FullSuiteRequest[] = [];
    const handle = createHandlers({
      worktreeId: "0123456789abcdef" as never,
      root: "/" as never,
      squealVersion: "0.0.0-test",
      startedAt: 1 as never,
      token: "t",
      phase: () => "ready",
      requestFullSuite: (request) => {
        asked.push(request);
        return new Promise(() => {});
      },
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
    });
    handle({ type: "run-all", force: true, observeIgnored: true });
    handle({ type: "run-all", force: false });
    expect(asked).toEqual([
      { force: true, observeIgnored: true },
      { force: false, observeIgnored: false },
    ]);
  });

  it("reaches the daemon's requestFullSuite through the front desk", async () => {
    const dir = mkdtempSync("/tmp/sq-warm-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const asked: FullSuiteRequest[] = [];
    const desk = await prepareFrontDesk().open(
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
        requestFullSuite: (request) => {
          asked.push(request);
          return new Promise(() => {});
        },
        requestSlowSuite: () => new Promise(() => {}),
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    await requestDaemon(socketPath, { type: "run-all", observeIgnored: true }, 2_000);
    await expect.poll(() => asked).toEqual([{ force: false, observeIgnored: true }]);
  });
});
