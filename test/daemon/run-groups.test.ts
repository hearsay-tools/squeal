import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  GroupRecord,
  membersOf,
  type RecordedGroup,
  readGroups,
  STOPPED_WHAT,
  stopGroups,
  writeGroups,
} from "../../src/core/daemon/run-groups.js";
import {
  type ProcessEntry,
  statOf,
  describe as stopNote,
} from "../../src/core/daemon/terminate.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3): the record of the process groups a
 * `--run` run started, and their stop, by recorded group id and leader
 * start only.
 */

const entry = (pid: number, pgrp: number, start: number): ProcessEntry => ({
  pid,
  ppid: 1,
  pgrp,
  start,
});

describe("membersOf", () => {
  const group: RecordedGroup = { pgid: 100, start: 50, runId: "r" };

  it("takes the leader and the members started at or after it", () => {
    const entries = [entry(100, 100, 50), entry(101, 100, 60), entry(102, 7, 60)];
    expect(membersOf(group, entries).map(({ pid }) => pid)).toEqual([100, 101]);
  });

  it("takes the members by group id when the leader is gone", () => {
    expect(membersOf(group, [entry(101, 100, 60)]).map(({ pid }) => pid)).toEqual([101]);
  });

  it("takes nothing when a live leader's start differs: the id is another process's", () => {
    expect(membersOf(group, [entry(100, 100, 90), entry(101, 100, 95)])).toEqual([]);
  });
});

describe("the record file", () => {
  it("writes, reads back and removes itself when empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-run-groups-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "sub", "groups.json") as AbsolutePath;
    const record = new GroupRecord(file);
    const one = { pgid: 4242, start: 10, runId: "a" };
    record.add(one);
    record.add(one);
    record.add({ pgid: 4343, start: 11, runId: "a" });
    expect(readGroups(file)).toEqual([one, { pgid: 4343, start: 11, runId: "a" }]);
    expect(new GroupRecord(file).list()).toHaveLength(2);
    record.remove(record.list());
    expect(readGroups(file)).toEqual([]);
    writeGroups(file, []);
    expect(readGroups(file)).toEqual([]);
  });
});

/** A sleeping node in a session and group of its own, with an empty env. */
function detached(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
    env: {},
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
  return pid;
}

async function started(pid: number): Promise<ProcessEntry> {
  for (let i = 0; i < 100; i++) {
    const found = statOf(pid);
    if (found !== null && found.pgrp === pid) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not start`);
}

describe.runIf(process.platform === "linux")("stopGroups", () => {
  it("stops a recorded group, names it with its run, and leaves a process outside it", async () => {
    const inside = await started(detached());
    const outside = await started(detached());
    const stopped = await stopGroups([{ pgid: inside.pid, start: inside.start, runId: "run-1" }]);
    expect(stopped.map(({ pid }) => pid)).toEqual([inside.pid]);
    expect(stopped[0]?.run).toBe("run run-1");
    expect(statOf(inside.pid)).toBeNull();
    expect(statOf(outside.pid)?.start).toBe(outside.start);
    const note = stopNote(stopped, STOPPED_WHAT);
    expect(note?.text).toMatch(/^stopped 1 process in a process group a `--run` run started: /);
    expect(note?.text).toContain(String(inside.pid));
  });

  it("never signals a group whose id a live leader of another start holds", async () => {
    const other = await started(detached());
    const stopped = await stopGroups([{ pgid: other.pid, start: other.start - 1, runId: "r" }]);
    expect(stopped).toEqual([]);
    expect(statOf(other.pid)?.start).toBe(other.start);
  });
});
