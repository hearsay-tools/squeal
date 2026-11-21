import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { requestGroup } from "../../src/core/daemon/run-group.js";
import type { RecordedRun } from "../../src/core/daemon/run-groups.js";
import {
  AtRunRequests,
  flagAccepted,
  withRunGroups,
} from "../../src/core/daemon/run-groups-watch.js";
import { statOf } from "../../src/core/daemon/terminate.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter, RunOptions } from "../../src/core/types/runner.js";
import type { CatchUpFile } from "./catch-up-fixture.js";
import { ranPaths } from "./group-lanes-fixture.js";
import { heldSide } from "./take-back-fixture.js";

/*
 * Row 023-36 (T3; review wave-20 third look): a `status --at --run`
 * request selects A, which has a current result, and B, which has none, so
 * it queues only B. It flags B alone: a later ordinary run of A is no
 * `--run` run, and the detached child its test starts keeps running; a run
 * of B, the request's own work, stops its child.
 */

const FILES: readonly CatchUpFile[] = [
  { path: "test/browser/a.test.ts", ms: 10, imports: ["src/a.ts"] },
  { path: "test/browser/b.test.ts", ms: 10, imports: ["src/b.ts"] },
  { path: "test/browser/c.test.ts", ms: 10, imports: ["src/c.ts"] },
];
const A: TestFileRef = { project: "", path: "test/browser/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/browser/b.test.ts" };
const C: TestFileRef = { project: "", path: "test/browser/c.test.ts" };

/** A runner whose test starts a detached child with the run's env, as the recorder carries it. */
function startingRunner(children: number[]): RunnerAdapter {
  const run = async (_files: readonly unknown[], options: RunOptions) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
      env: { ...options.childEnv },
    });
    child.unref();
    const pid = child.pid;
    if (pid === undefined) throw new Error("no pid");
    onTestFinished(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // gone
      }
    });
    for (let i = 0; i < 100 && statOf(pid)?.pgrp !== pid; i++) await delay(20);
    children.push(pid);
    return { end: "completed", completedFiles: [], results: [] };
  };
  return {
    name: "starter",
    adapterVersion: "1",
    traits: {},
    run,
    close: async () => {},
  } as unknown as RunnerAdapter;
}

describe("a --run request over a current file and an unknown one (023-36, third look)", {
  timeout: 60_000,
}, () => {
  it("flags only the file it queued, so an ordinary run of the current one keeps its child", async () => {
    const { side, gate } = await heldSide(FILES);
    gate.stop();
    // A has a current result first, through an ordinary narrow run.
    await requestGroup(side.scheduler, "browser", undefined, [A.path], {});
    await expect.poll(() => side.current(A.path), { timeout: 20_000 }).toBe(true);
    await side.rest();
    const ran = ranPaths(side).length;

    const requests = new AtRunRequests();
    const options = { owner: "call-1", at: true } as const;
    const requested = await requestGroup(
      side.scheduler,
      "browser",
      undefined,
      [A.path, B.path],
      options,
    );
    flagAccepted(requests, requested, options);
    expect(requested?.narrow?.selected.map(({ path }) => path).sort()).toEqual([A.path, B.path]);
    expect(requested?.newlyQueued?.map(({ path }) => path)).toEqual([B.path]);
    expect(requests.flagged([A])).toBe(false);
    expect(requests.flagged([B])).toBe(true);
    await expect.poll(() => side.current(B.path), { timeout: 20_000 }).toBe(true);
    expect(ranPaths(side).slice(ran)).toEqual([B.path]);

    // The daemon's runner, seen through withRunGroups: an ordinary run of A, then B's.
    const children: number[] = [];
    const recorded: RecordedRun[] = [];
    const runner = withRunGroups(startingRunner(children), {
      requests,
      record: { add: (run) => recorded.push(run), saw: () => {}, remove: () => {} },
      note: () => {},
      // The test's own process starts the children here: no worker of the run to spare.
      workers: () => () => false,
    });
    const at = (runId: string): RunOptions => ({ runId, logDir: "/tmp", timeoutMs: null });
    await runner.run([A], at("ordinary-a"));
    const [ofA] = children;
    expect(recorded).toEqual([]);
    expect(ofA === undefined ? null : statOf(ofA)).not.toBeNull();
    await runner.run([B], at("at-run-b"));
    const ofB = children[1];
    expect(recorded.map(({ runId }) => runId)).toEqual(["at-run-b"]);
    expect(ofB === undefined ? "none" : statOf(ofB)).toBeNull();
    expect(ofA === undefined ? null : statOf(ofA)).not.toBeNull();
  });

  it("flags neither a running file nor one an ordinary request queued", async () => {
    const { side, gate } = await heldSide(FILES);
    // An ordinary request: A starts and is held (one file a tier), C waits in the queue.
    await requestGroup(side.scheduler, "browser", undefined, [A.path, C.path], {});
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const running = ranPaths(side)[0];
    const requests = new AtRunRequests();
    const options = { owner: "call-2", at: true } as const;
    const all = [A.path, B.path, C.path];
    const requested = await requestGroup(side.scheduler, "browser", undefined, all, options);
    flagAccepted(requests, requested, options);
    gate.stop();
    expect(requested?.newlyQueued?.map(({ path }) => path)).toEqual([B.path]);
    expect(requests.flagged([B])).toBe(true);
    for (const ref of [A, C]) expect(requests.flagged([ref]), ref.path).toBe(false);
    expect([A.path, C.path]).toContain(running);
  });
});
