import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { leftovers, marksOf } from "../../src/core/daemon/leftovers.js";
import { statOf } from "../../src/core/daemon/terminate.js";

/**
 * `squeal stop`'s wait for what the daemon started (D10, task 001-367),
 * against real processes. Review 001-429 B1: a process its starter put in
 * the daemon's group, and what that process starts later, is not the
 * daemon's.
 */

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const step of cleanup.splice(0)) {
    try {
      step();
    } catch {}
  }
});

/** The group's members other than `group` itself. */
function members(group: number): number[] {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((pid) => pid !== group && statOf(pid)?.pgrp === group);
}

function descends(pid: number, from: number): boolean {
  for (let at = statOf(pid), hops = 0; at !== null && hops < 64; hops++) {
    if (at.ppid === from) return true;
    at = statOf(at.ppid);
  }
  return false;
}

function args(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "latin1").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
}

async function until(what: string, check: () => boolean): Promise<void> {
  for (let waited = 0; !check(); waited += 25) {
    if (waited > 10_000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * A group leader standing in for the daemon. A subshell puts a stranger in
 * its group and exits, so the stranger is no descendant of the leader. Once
 * `go` exists, the stranger starts a child and the leader one of its own.
 */
function groupWithStranger(go: string): ChildProcess {
  const script = [
    `(sh -c 'while [ ! -f "$GO" ]; do sleep 0.05; done; sleep 61; :' &)`,
    'while [ ! -f "$GO" ]; do sleep 0.05; done',
    "sleep 62 &",
    "wait",
  ].join("\n");
  const leader = spawn("sh", ["-c", script], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, GO: go },
  });
  cleanup.push(() => process.kill(-(leader.pid as number), "SIGKILL"));
  return leader;
}

describe.runIf(process.platform === "linux")("leftovers", () => {
  it("names what the daemon started, never a stranger of its group or the stranger's child", async () => {
    const go = join(tmpdir(), `squeal-leftovers-${process.pid}-${Date.now()}`);
    cleanup.push(() => rmSync(go, { force: true }));
    const pid = groupWithStranger(go).pid as number;
    await until("the stranger to join the group", () =>
      members(pid).some((member) => !descends(member, pid)),
    );
    const marks = marksOf(pid, null);
    expect(marks.group).toBe(pid);
    expect(marks.foreign.size).toBeGreaterThan(0);

    writeFileSync(go, "");
    const sleeping = (seconds: string) =>
      members(pid).filter((member) => args(member) === `sleep ${seconds}`);
    await until("both sleeps", () => sleeping("61").length === 1 && sleeping("62").length === 1);
    const own = sleeping("62");
    expect(descends(own[0] as number, pid)).toBe(true);
    expect(descends(sleeping("61")[0] as number, pid)).toBe(false);

    const named = (await leftovers(marks)).map((left) => left.pid);
    expect(named).toContain(own[0]);
    for (const member of named) expect(descends(member, pid)).toBe(true);
  });
});
