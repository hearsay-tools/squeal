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
 * Spec 011 C15, focused checks (row 011-145): a named wait with `--check`
 * sends `focus` with the test files its paths select by themselves, the
 * texts and what is left of the wait. The daemon answers at once and hands
 * them to the scheduler, as `promote`; one without it answers an error, and
 * a daemon from before the request answers it unknown, as before.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const Z: TestFileRef = { project: "", path: "test/z.test.ts" };

type Call = [readonly TestFileRef[], readonly string[], number];

function handler(requestFocus: NonNullable<HandlerContext["requestFocus"]> | null) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => "ready",
    requestFullSuite: () => new Promise(() => {}),
    ...(requestFocus === null ? {} : { requestFocus }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

describe("the focus request (spec 011 C15, row 011-145)", () => {
  it("parses the test files, the texts and the time left, and refuses anything else", () => {
    const line = JSON.stringify({
      type: "focus",
      testFiles: [{ ...Z, extra: 1 }],
      texts: ["parity > U2", "U3"],
      withinMs: 5,
    });
    expect(parseRequest(line)).toEqual({
      type: "focus",
      testFiles: [Z],
      texts: ["parity > U2", "U3"],
      withinMs: 5,
    });
    expect(
      parseRequest('{"type":"focus","testFiles":[{"path":"a"}],"texts":["x"],"withinMs":5}'),
    ).toBe('"testFiles" must be a list of { project, path } strings');
    for (const texts of ["[]", '[""]', "[1]", '"x"']) {
      expect(parseRequest(`{"type":"focus","testFiles":[],"texts":${texts},"withinMs":5}`)).toBe(
        '"texts" must be a list of non-empty strings',
      );
    }
    expect(parseRequest('{"type":"focus","testFiles":[],"texts":["x"],"withinMs":-1}')).toBe(
      '"withinMs" must be a number of milliseconds',
    );
  });

  it("answers at once and hands the files and texts to the scheduler", () => {
    const calls: Call[] = [];
    const handle = handler((files, texts, withinMs) => {
      calls.push([files, texts, withinMs]);
      return new Promise(() => {});
    });
    expect(handle({ type: "focus", testFiles: [Z], texts: ["U2"], withinMs: 60_000 })).toEqual({
      schemaVersion: expect.any(Number),
      ok: true,
      type: "focus",
    });
    expect(calls).toEqual([[[Z], ["U2"], 60_000]]);
  });

  it("refuses on a daemon that cannot focus, and an unknown type answers as before", () => {
    expect(handler(null)({ type: "focus", testFiles: [Z], texts: ["U2"], withinMs: 1 })).toEqual({
      schemaVersion: expect.any(Number),
      ok: false,
      error: "this daemon cannot focus",
    });
    expect(parseRequest('{"type":"focus-later","testFiles":[]}')).toBe(
      'unknown request type "focus-later"',
    );
  });
});

describe("focus through the front desk", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's requestFocus $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-focus-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const calls: Call[] = [];
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
        requestFocus: async (files, texts, withinMs) => {
          calls.push([files, texts, withinMs]);
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const request = { type: "focus", testFiles: [Z], texts: ["U2"], withinMs: 30_000 } as const;
    expect(await requestDaemon(socketPath, request, 2_000)).toMatchObject({
      ok: true,
      type: "focus",
    });
    await expect.poll(() => calls).toEqual([[[Z], ["U2"], 30_000]]);
  });

  it("answers an error from a desk the daemon gave no requestFocus", async () => {
    const dir = mkdtempSync("/tmp/sq-focus-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const desk = await prepareFrontDesk(null).open(
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
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    const request = { type: "focus", testFiles: [Z], texts: ["U2"], withinMs: 1 } as const;
    expect(await requestDaemon(socketPath, request, 2_000)).toMatchObject({
      ok: false,
      error: "this daemon cannot focus",
    });
  });
});
