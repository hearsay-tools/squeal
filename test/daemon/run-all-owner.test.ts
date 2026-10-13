import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import type { AbsolutePath, CheckpointRecord, RevisionNumber } from "../../src/core/types/index.js";

/*
 * Review wave-3, B4: the checkpoint whose tiers do a `run --all` request's
 * work crosses the front desk as `owner`, beside the request's own record,
 * the same in the `run-all` answer and every `run-all-status` after it.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const record: CheckpointRecord = {
  id: "c1",
  worktreeId: "0123456789abcdef" as never,
  revision: 1 as RevisionNumber,
  kind: "run-all",
  testFiles: [],
  startedAt: 1 as never,
  completedAt: null,
  end: null,
};

describe("the run-all answer's owner (review wave-3, B4)", () => {
  it("names the checkpoint the scheduler joined, and keeps the record as the store holds it", async () => {
    const dir = mkdtempSync("/tmp/sq-owner-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const desk = await prepareFrontDesk().open(
      {
        socketPath,
        worktreeId: record.worktreeId,
        root: "/",
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
        token: "t",
      },
      {
        onActivity: () => {},
        requestFullSuite: () => Promise.resolve({ ...record, owner: "c0" }),
        requestSlowSuite: () => new Promise(() => {}),
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    const first = await requestDaemon(socketPath, { type: "run-all" }, 2_000);
    if (first === null || !first.ok || first.type !== "run-all") throw new Error("no answer");
    const status = () =>
      requestDaemon(socketPath, { type: "run-all-status", requestId: first.requestId }, 2_000);
    await expect.poll(status).toMatchObject({ checkpoint: record, owner: "c0" });
    const answer = await status();
    expect(answer).toMatchObject({ ok: true, type: "run-all", error: null });
    expect(answer).not.toHaveProperty("checkpoint.owner");
  });
});
