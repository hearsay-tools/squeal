import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Life, lifeOf } from "../../src/core/daemon/terminate.js";
import { daemonStart, processStopped, startMarkFor } from "../../src/core/presence/marks.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { NOW } from "./fixture.js";

/*
 * Row 005-111: the start mark's process may be stopped (`/proc/<pid>/stat` state `T` or `t`),
 * read on Linux only (`processStopped`).
 */

const life = (stopped: boolean): Life => ({
  pid: 7,
  ppid: 1,
  pgrp: 7,
  start: 1,
  dying: false,
  zombie: false,
  stopped,
});

describe("processStopped (row 005-111)", () => {
  it("reads the state on Linux: stopped, running, or no process", () => {
    expect(processStopped(7, "linux", () => life(true))).toBe(true);
    expect(processStopped(7, "linux", () => life(false))).toBe(false);
    expect(processStopped(7, "linux", () => null)).toBe(false);
  });

  it("reads no state off Linux: a process reads as running, as before", () => {
    const read = (): Life => {
      throw new Error("no state is read off Linux");
    };
    expect(processStopped(7, "darwin", read)).toBe(false);
    expect(processStopped(7, "win32", read)).toBe(false);
  });
});

const dirs: string[] = [];
const children: number[] = [];
afterEach(() => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone already.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Polls `lifeOf(pid)` until its `stopped` is `want`, for up to 5 s. */
async function until(pid: number, want: boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (lifeOf(pid)?.stopped !== want) {
    if (Date.now() > deadline) throw new Error(`pid ${pid} never read stopped: ${want}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe.skipIf(process.platform !== "linux")("a real SIGSTOPped start (row 005-111)", () => {
  it("reads as a locked start that is stopped, and as before once it continues", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error("no child");
    children.push(pid);
    const dir = mkdtempSync("/tmp/sq-marks-stopped-");
    dirs.push(dir);
    const file = join(dir, "daemon.lock") as AbsolutePath;
    const startTime = lifeOf(pid)?.start;
    writeFileSync(startMarkFor(file), JSON.stringify({ pid, startTime }));

    expect(daemonStart(file, NOW as EpochMs)).toEqual({
      kind: "locked",
      pid,
      since: expect.any(Number),
    });
    process.kill(pid, "SIGSTOP");
    await until(pid, true);
    expect(daemonStart(file, NOW as EpochMs)).toMatchObject({ kind: "locked", pid, stopped: true });
    process.kill(pid, "SIGCONT");
    await until(pid, false);
    expect(daemonStart(file, NOW as EpochMs)).not.toHaveProperty("stopped");
  });
});
