import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import type { AbsolutePath } from "../../src/core/types/index.js";

/*
 * Task 001-281: a hook's `nudge` reaches the daemon's main thread as
 * `onNudge`, beside the activity it always counted as, whichever thread
 * serves the socket. The daemon hands it to `Scheduler.nudge`.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("nudge through the front desk (task 001-281)", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the daemon's onNudge $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-nudge-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    let activity = 0;
    let nudges = 0;
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
        onActivity: () => activity++,
        onNudge: () => nudges++,
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

    expect(await requestDaemon(socketPath, { type: "nudge" }, 2_000)).toMatchObject({
      ok: true,
      type: "nudge",
    });
    await expect.poll(() => nudges).toBe(1);
    expect(activity).toBe(1);
    // Other requests count as activity and nudge nothing.
    await requestDaemon(socketPath, { type: "run-slow" }, 2_000);
    await expect.poll(() => activity).toBe(2);
    expect(nudges).toBe(1);
  });
});
