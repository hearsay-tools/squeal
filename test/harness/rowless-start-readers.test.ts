import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Life } from "../../src/core/daemon/terminate.js";
import { startMarkFor } from "../../src/core/presence/marks.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { STOP_SLOW_DOWN_MS } from "../../src/harness/shared/stop-slow.js";
import { recorded, type SquealRepo } from "./helpers.js";
import { holdStart, T } from "./starting-fixture.js";
import {
  decision,
  deps,
  edit,
  HARNESSES,
  markStopWait,
  repo,
  stopThenWait,
} from "./stop-slow-helpers.js";

/*
 * Row 005-115: row 005-108 let delivery read a row-less worktree's start by its lock
 * (`commonDir`). The hook readers that call `readLiveHeader` themselves (Stop's decision, the
 * stopped-by-request read, the waiting Stop entry and the test-command deny) read that start too.
 * Each call's daemon liveness is recorded by the source file that made it.
 */

const stoppedPids = new Set<number>();

// Row 005-111's process-state reader: the real one, stopped for the pids in `stoppedPids`.
vi.mock("../../src/core/daemon/terminate.js", async (real) => {
  const actual = await real<typeof import("../../src/core/daemon/terminate.js")>();
  return {
    ...actual,
    lifeOf: (pid: number): Life | null => {
      const life = actual.lifeOf(pid);
      return life === null ? null : { ...life, stopped: stoppedPids.has(pid) };
    },
  };
});

const reads: { readonly caller: string; readonly daemon: DaemonLiveness | undefined }[] = [];

vi.mock("../../src/core/delivery/liveness.js", async (real) => {
  const actual = await real<typeof import("../../src/core/delivery/liveness.js")>();
  return {
    ...actual,
    readLiveHeader: (...args: Parameters<typeof actual.readLiveHeader>) => {
      const header = actual.readLiveHeader(...args);
      const caller = /(\w[\w-]*)\.ts/.exec(new Error().stack?.split("\n")[2] ?? "")?.[1] ?? "?";
      reads.push({ caller, daemon: header.daemon });
      return header;
    },
  };
});

beforeEach(() => {
  reads.length = 0;
});
afterEach(() => stoppedPids.clear());

const harness = HARNESSES[0] as (typeof HARNESSES)[number];
const READERS = ["stop-decide", "stop-required", "stop-slow", "deny"];

/** The daemon states each hook reader (`READERS`) read, by its file. */
function readersSaw(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { caller, daemon } of reads) {
    if (!READERS.includes(caller)) continue;
    const state = daemon === undefined ? "none" : startingOrState(daemon);
    const seen = out[caller] ?? [];
    if (!seen.includes(state)) out[caller] = [...seen, state];
  }
  return out;
}

const startingOrState = (d: DaemonLiveness): string =>
  d.state === "down" && d.startMark === "start" ? "starting" : d.state;

/** `repo`'s Stop fixture, its worktree row removed and its daemon holding the lock in its start. */
async function rowless(
  stop: Parameters<typeof repo>[1],
  marked = true,
  start: "running" | "gone" = "running",
): Promise<SquealRepo> {
  const r = await repo(harness, stop, false);
  // Removing the row removes its consumers: the session registers again, then edits.
  r.store.worktrees.remove(r.worktreeId);
  const lockFile = lockFileFor(r.repo.commonDir as AbsolutePath, r.worktreeId as WorktreeId);
  mkdirSync(dirname(lockFile), { recursive: true });
  if (start === "running") holdStart(lockFile, Date.now() - T);
  else {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(startMarkFor(lockFile), JSON.stringify({ pid: gone, startTime: 1 }));
  }
  await harness.startTurn(r);
  edit(r);
  if (marked) markStopWait(r, harness.name);
  reads.length = 0;
  return r;
}

describe("a row-less worktree whose daemon holds the lock in its start (row 005-115)", () => {
  it("Stop's decision and its stopped-by-request read say starting", async () => {
    // Without the waiting entry known, the 2 s entry blocks on the slow file and reads both.
    const r = await rowless({ requireSlowSuite: true }, false);
    const out = decision(await harness.stop(r));
    expect(out.decision).toBe("block");
    // On main: "No daemon is running; results are as of revision 1."
    expect(out.reason).not.toContain("No daemon is running");
    const saw = readersSaw();
    expect(saw["stop-decide"]).toEqual(["starting"]);
    expect(saw["stop-required"]).toEqual(["starting"]);
  });

  it("the test-command deny reads starting", async () => {
    const r = await rowless({});
    r.policy({ testCommand: { denyWhenCurrent: true } });
    const bash = { tool_name: "Bash", tool_input: { command: "npx vitest run" } };
    await runHook("pre-tool-use", recorded("pre-tool-use", r.root, bash), deps);
    expect(readersSaw().deny).toEqual(["starting"]);
  });

  it("a slow Stop wait reads starting and waits on past STOP_SLOW_DOWN_MS to its bound", async () => {
    const r = await rowless({ requireSlowSuite: true, slowWaitMs: 60_000 });
    let fake = 0;
    // 5 s per read of the wait's clock: the old rule ended the wait after 10 s of down.
    const fast: HookDeps = { ...deps, pollIntervalMs: 1, monotonicNow: () => (fake += 5_000) };
    const { quick, waiting: out } = await stopThenWait(harness, r, () => {}, fast);
    expect(quick).toEqual({});
    expect(readersSaw()["stop-slow"]).toEqual(["starting"]);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("after 60 s");
    expect(fake).toBeGreaterThan(STOP_SLOW_DOWN_MS * 4);
  });

  // 5 s per read of the wait's clock, as above: the wait ends once down for STOP_SLOW_DOWN_MS.
  const endsDown = async (r: SquealRepo) => {
    let fake = 0;
    const fast: HookDeps = { ...deps, pollIntervalMs: 1, monotonicNow: () => (fake += 5_000) };
    const { waiting } = await stopThenWait(harness, r, () => {}, fast);
    expect(waiting.decision).toBe("block");
    expect(waiting.reason).not.toContain("after 60 s");
    expect(fake).toBeLessThan(STOP_SLOW_DOWN_MS * 4);
  };

  it("a slow Stop wait ends as daemon down when the starting process is stopped (row 005-111)", async () => {
    const r = await rowless({ requireSlowSuite: true, slowWaitMs: 60_000 });
    stoppedPids.add(process.pid);
    await endsDown(r);
    expect(reads.find((x) => x.caller === "stop-slow")?.daemon).toMatchObject({
      startStopped: true,
    });
  });

  it("a slow Stop wait ends as daemon down when the start mark names a process that is gone", async () => {
    const r = await rowless({ requireSlowSuite: true, slowWaitMs: 60_000 }, true, "gone");
    await endsDown(r);
    expect(readersSaw()["stop-slow"]).toEqual(["down"]);
  });
});
