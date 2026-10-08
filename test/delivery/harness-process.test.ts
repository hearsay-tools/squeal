import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { harnessGone, recordHarness } from "../../src/core/delivery/harness-process.js";
import {
  dropGoneHarnesses,
  harnessOf,
  pidNamespace,
  readProcStat,
} from "../../src/core/delivery/index.js";
import { storePaths } from "../../src/core/store/index.js";
import type { Consumer, HarnessProcess } from "../../src/core/types/index.js";
import { acquireWaiterLock, waiterLockPath } from "../../src/core/waiter-lock/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Lessons, defect 24: a consumer whose recorded harness process is gone is
 * dropped at the daemon's next heartbeat. Gone means the stat file is
 * missing, the start time differs (a reused PID) or the process is a zombie
 * (`research/harness-process-liveness.md`).
 */

const linux = process.platform === "linux";
const WT = "0123456789abcdef";
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function sleeper(): ChildProcess & { pid: number } {
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  children.push(child);
  if (child.pid === undefined) throw new Error("sleep did not start");
  return child as ChildProcess & { pid: number };
}

function identity(pid: number): HarnessProcess {
  const stat = readProcStat(pid);
  const namespace = pidNamespace();
  if (stat === null || namespace === null) throw new Error(`no process ${pid}`);
  return { pid, startTime: stat.startTime, pidNamespace: namespace };
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });

describe.runIf(linux)("harnessGone", () => {
  it("reads its own stat: a live process is not gone", () => {
    const self = identity(process.pid);
    expect(readProcStat(process.pid)?.ppid).toBe(process.ppid);
    expect(harnessGone(self, pidNamespace())).toBe(false);
  });

  it("is gone after SIGKILL, and a PID reused by another process is not the harness", async () => {
    const child = sleeper();
    const recorded = identity(child.pid);
    expect(harnessGone({ ...recorded, startTime: recorded.startTime - 1 }, pidNamespace())).toBe(
      true,
    );
    child.kill("SIGKILL");
    await exited(child);
    expect(harnessGone(recorded, pidNamespace())).toBe(true);
  });

  it("counts a zombie as gone", async () => {
    // The background sleep's parent execs into `sleep 5`, which never reaps it.
    const parent = spawn("bash", ["-c", "sleep 0.05 & echo $!; exec sleep 5"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    children.push(parent);
    const pid = await new Promise<number>((resolve) =>
      parent.stdout?.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))),
    );
    const recorded = identity(pid);
    for (let i = 0; i < 100 && readProcStat(pid)?.state !== "Z"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(readProcStat(pid)?.state).toBe("Z");
    expect(harnessGone(recorded, pidNamespace())).toBe(true);
  });

  it("never judges a process of another PID namespace, or without one of its own", async () => {
    const child = sleeper();
    const recorded = identity(child.pid);
    child.kill("SIGKILL");
    await exited(child);
    expect(harnessGone({ ...recorded, pidNamespace: "pid:[1]" }, pidNamespace())).toBe(false);
    expect(harnessGone(recorded, null)).toBe(false);
  });
});

describe("dropGoneHarnesses", () => {
  const consumer = (sessionId: string, agentId = "main"): Consumer => ({
    worktreeId: WT,
    sessionId,
    agentId,
  });
  const harness = (pid: number): HarnessProcess => ({ pid, startTime: 7, pidNamespace: "ns" });

  function seeded() {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const { locksDir } = storePaths(commonDir);
    mkdirSync(locksDir, { recursive: true });
    const add = (c: Consumer, h: HarnessProcess | null) => {
      store.consumers.register(c, 1);
      store.transaction(() => recordHarness(store, c, h));
    };
    return { store, locksDir, add };
  }

  it("drops every consumer of a gone process with its lock file, once per process, and keeps the rest", () => {
    const { store, locksDir, add } = seeded();
    const main = consumer("s1");
    const sub = consumer("s1", "agent");
    const cleared = consumer("s2");
    const live = consumer("s3");
    const old = consumer("s4");
    add(main, harness(100));
    add(sub, harness(100));
    add(cleared, harness(100));
    add(live, harness(200));
    add(old, null);
    acquireWaiterLock(locksDir, main)?.release(false);
    const asked: number[] = [];

    const dropped = dropGoneHarnesses(store, WT, 10, {
      locksDir,
      isGone: (h) => {
        asked.push(h.pid);
        return h.pid === 100;
      },
    });

    expect(dropped).toEqual(expect.arrayContaining([main, sub, cleared]));
    expect(dropped).toHaveLength(3);
    expect(asked.sort()).toEqual([100, 200]);
    expect(store.consumers.list(WT).map((r) => r.consumer.sessionId)).toEqual(["s3", "s4"]);
    expect(existsSync(waiterLockPath(locksDir, main))).toBe(false);
    expect(harnessOf(store, main)).toBeNull();
    expect(harnessOf(store, live)).toEqual(harness(200));
  });

  it("keeps a consumer that registered again from another process meanwhile", () => {
    const { store, locksDir, add } = seeded();
    const resumed = consumer("s1");
    add(resumed, harness(100));

    const dropped = dropGoneHarnesses(store, WT, 10, {
      locksDir,
      isGone: () => {
        // `claude --resume` registers the session from a new process before the drop commits.
        store.transaction(() => recordHarness(store, resumed, harness(300)));
        return true;
      },
    });

    expect(dropped).toEqual([]);
    expect(store.consumers.get(resumed)).not.toBeNull();
  });
});
