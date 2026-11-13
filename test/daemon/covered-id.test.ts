import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import type { DaemonRequest, DaemonResponse } from "../../src/core/types/daemon.js";
import type { CheckpointRecord } from "../../src/core/types/store-records.js";

/*
 * Row 011-325: the `run-all`, `run-slow` and `run-group` answers carry the
 * id of the request's covered files (`readCoveredFiles`) as one optional
 * field, across the front desk: `coveredId` beside `owner` for `run-all`,
 * never in its checkpoint, and `requested.coveredId` for the others. A
 * scheduler that names none (one before the row, or a lint group) gives
 * an answer without the field.
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
const taken = { revision: 1 as RevisionNumber, queued: 2 };

/** A front desk whose scheduler takes each request at once, naming `coveredId` when given. */
async function desk(coveredId: string | undefined): Promise<AbsolutePath> {
  const dir = mkdtempSync("/tmp/sq-covered-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  const id = coveredId === undefined ? {} : { coveredId };
  const opened = await prepareFrontDesk().open(
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
      requestFullSuite: () => Promise.resolve({ ...record, owner: "c0", ...id }),
      requestSlowSuite: () => Promise.resolve({ ...taken, ...id }),
      requestGroup: () => Promise.resolve({ ...taken, ...id }),
      requestSync: () => new Promise(() => {}),
      onStop: () => {},
      onStepDown: () => {},
      onFailure: () => {},
    },
  );
  cleanups.push(() => opened.close());
  opened.setPhase("ready");
  return socketPath;
}

/** The request's answer once the scheduler took it, polled by its status request. */
async function takenAnswer(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  status: "run-all-status" | "run-slow-status" | "run-group-status",
): Promise<DaemonResponse> {
  const first = await requestDaemon(socketPath, request, 2_000);
  if (first === null || !first.ok || !("requestId" in first)) throw new Error("no answer");
  const poll = () => requestDaemon(socketPath, { type: status, requestId: first.requestId }, 2_000);
  await expect
    .poll(async () => {
      const answer = await poll();
      return answer?.ok === true && "requested" in answer
        ? answer.requested
        : answer?.ok === true && "checkpoint" in answer
          ? answer.checkpoint
          : null;
    })
    .not.toBeNull();
  const answer = await poll();
  if (answer === null) throw new Error("no status answer");
  return answer;
}

describe("the answers' covered files id (row 011-325)", () => {
  it("run-all: beside owner, never in the checkpoint", async () => {
    const answer = await takenAnswer(await desk("r1"), { type: "run-all" }, "run-all-status");
    expect(answer).toMatchObject({ checkpoint: record, owner: "c0", coveredId: "r1" });
    expect(answer).not.toHaveProperty("checkpoint.coveredId");
  });

  it.each([
    ["run-slow", { type: "run-slow" }, "run-slow-status"],
    ["run-group", { type: "run-group", group: "tests" }, "run-group-status"],
  ] as const)("%s: in what the scheduler took", async (_, request, status) => {
    const answer = await takenAnswer(await desk("r1"), request, status);
    expect(answer).toMatchObject({ requested: { ...taken, coveredId: "r1" } });
  });

  it.each([
    ["run-all", { type: "run-all" }, "run-all-status"],
    ["run-slow", { type: "run-slow" }, "run-slow-status"],
    ["run-group", { type: "run-group", group: "tests" }, "run-group-status"],
  ] as const)("%s: absent when the scheduler names none", async (_, request, status) => {
    const answer = await takenAnswer(await desk(undefined), request, status);
    expect(JSON.stringify(answer)).not.toContain("coveredId");
  });
});
