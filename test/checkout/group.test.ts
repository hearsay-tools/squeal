import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { stopRecordedGroup } from "../../src/core/checkout/checkout.js";
import { readMarker, recordGroup, writeMarker } from "../../src/core/checkout/marker.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";

/*
 * Row 023-16 (review wave-5 B3): a checkout's marker records its install's
 * process group, and `stopRecordedGroup` stops that group only while it is
 * still the install's.
 */

const dirs: string[] = [];
const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0)) if (alive(pid)) process.kill(-pid, "SIGKILL");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the install group of a checkout", () => {
  it("is recorded in the marker and read back", () => {
    const folder = mkdtempSync(join(tmpdir(), "sq-group-"));
    dirs.push(folder);
    expect(() => recordGroup(folder, leaseProcess())).toThrow(/holds no checkout marker/);
    const marker = {
      v: 1,
      owner: leaseProcess(),
      commit: "c",
      commonDir: "/g",
      createdAt: 1,
    } as const;
    writeMarker(folder, marker);
    expect(readMarker(folder)?.group).toBeUndefined();
    const group = { pid: 4242, startTime: 7, pidNamespace: "pid:[1]" };
    recordGroup(folder, group);
    expect(readMarker(folder)).toEqual({ ...marker, group });
  });

  it("stops a live group by its leader, and leaves a pid another process holds", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid as number;
    pids.push(pid);
    const exited = new Promise((done) => child.once("exit", done));
    const leader = leaseProcess(pid);
    // The same pid with another start time is another process: no signal.
    if (leader.startTime !== null) {
      await stopRecordedGroup({ ...leader, startTime: leader.startTime + 1 });
      await delay(100);
      expect(alive(pid)).toBe(true);
    }
    await stopRecordedGroup(leader);
    await exited;
    expect(alive(pid)).toBe(false);
    // A gone leader whose group has no member: nothing to stop.
    await stopRecordedGroup(leader);
  });
});
