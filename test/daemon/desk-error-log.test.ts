import { describe, expect, it, onTestFinished, vi } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { createFixtureRepo, SLOW } from "./helpers.js";

/*
 * Review wave-13ak, B1 (task 001-287): the front desk catches what the
 * daemon's events throw and serves on; the daemon writes what it caught to
 * its log. The real desk, with the daemon's nudge made to throw.
 */

vi.mock("../../src/core/daemon/desk.js", async (importOriginal) => {
  const desk = await importOriginal<typeof import("../../src/core/daemon/desk.js")>();
  return {
    ...desk,
    prepareFrontDesk: (...args: Parameters<typeof desk.prepareFrontDesk>) => {
      const prepared = desk.prepareFrontDesk(...args);
      return {
        ...prepared,
        open: (identity, events) =>
          prepared.open(identity, {
            ...events,
            onNudge: () => {
              throw new Error("squeal scheduler: not started");
            },
          }),
      } satisfies typeof prepared;
    },
  };
});

describe("a caught front desk error reaches the daemon's log (review wave-13ak, B1)", SLOW, () => {
  it("logs a nudge that threw and keeps serving", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const lines: string[] = [];
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      log: (line) => lines.push(line),
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    const socketPath = repo.socketPath as AbsolutePath;

    expect(await requestDaemon(socketPath, { type: "nudge" }, 2_000)).toMatchObject({ ok: true });
    await expect.poll(() => lines).toContain("front desk: squeal scheduler: not started");
    expect(await requestDaemon(socketPath, { type: "ping" }, 2_000)).toMatchObject({ ok: true });
  });
});
