import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import type { AbsolutePath } from "../../src/core/types/index.js";

/*
 * Review wave-13ak, B1: a nudge while the scheduler started threw out of the
 * worker desk's message listener on the main thread, an uncaught exception
 * that ends the daemon. Every callback the desk hands the main thread's
 * events to catches what they throw and reports it through `onError`; a
 * request's synchronous throw becomes its error answer.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const notStarted = () => {
  throw new Error("squeal scheduler: not started");
};

describe("the front desk's callbacks never throw out (review wave-13ak, B1)", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("keeps serving when the main thread's events throw, $name", async ({ worker }) => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    cleanups.push(() => process.off("uncaughtException", onUncaught));
    const dir = mkdtempSync("/tmp/sq-guard-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const errors: string[] = [];
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
        onActivity: notStarted,
        onNudge: notStarted,
        requestFullSuite: notStarted,
        requestSlowSuite: notStarted,
        requestSync: notStarted,
        onStop: () => {},
        onStepDown: () => {},
        onFailure: (error) => errors.push(`failure: ${error.message}`),
        onError: (error) => errors.push(error.message),
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    expect(await requestDaemon(socketPath, { type: "nudge" }, 2_000)).toMatchObject({
      ok: true,
      type: "nudge",
    });
    await expect.poll(() => errors.length).toBeGreaterThanOrEqual(2);
    const slow = await requestDaemon(socketPath, { type: "run-slow" }, 2_000);
    expect(slow).toMatchObject({ ok: true, type: "run-slow" });
    const requestId = (slow as { requestId: string }).requestId;
    await expect
      .poll(async () => requestDaemon(socketPath, { type: "run-slow-status", requestId }, 2_000))
      .toMatchObject({ error: "squeal scheduler: not started" });
    // Still serving, nothing escaped and nothing ended the desk.
    expect(await requestDaemon(socketPath, { type: "ping" }, 2_000)).toMatchObject({ ok: true });
    expect(uncaught).toEqual([]);
    expect(errors.every((line) => line === "squeal scheduler: not started")).toBe(true);
  });
});
