import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { statOf } from "../../../src/core/daemon/terminate.js";
import { spawnSsh, sshRun } from "../../../src/core/runner-host/remote/ssh.js";

/*
 * Row 026-30: `ssh` runs in a process group of its own, so what it leaves
 * running, the shared master and its `ProxyCommand`, is never in the
 * daemon's group, where `EscapedChildren` takes a member no child of the
 * daemon descends from for a test's leftover (`pgrp === daemon`). A
 * one-shot command's deadline and abort settle at once, killing `ssh`
 * alone, even when a process it left holds its output.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-ssh-detached-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Process groups a test started, stopped after it. */
const groups: number[] = [];
afterEach(() => {
  for (const group of groups.splice(0)) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

/** A fake `ssh` running `body` with `sh`. */
function fakeSsh(name: string, body: string): string {
  const path = join(scratch, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function until<T>(read: () => T | null | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 20));
  }
}

const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;

describe.runIf(process.platform === "linux")("ssh in its own process group (row 026-30)", () => {
  it("leads its own group, and what it leaves behind stays out of the daemon's group", async () => {
    const pidFile = join(scratch, "leftover.pid");
    // Like a ControlMaster going to the background: a descendant that outlives `ssh`.
    const ssh = fakeSsh(
      "ssh-leaves",
      `sleep 30 </dev/null >/dev/null 2>&1 &\necho $! > ${JSON.stringify(pidFile)}\nsleep 0.3`,
    );
    const child = spawnSsh({ destination: "box", ssh }, "true");
    const pid = child.pid as number;
    groups.push(pid);
    const own = statOf(process.pid);
    const sshEntry = await until(() => statOf(pid));
    expect(sshEntry.pgrp).toBe(pid);
    expect(sshEntry.pgrp).not.toBe(process.pid);
    expect(sshEntry.pgrp).not.toBe(own?.pgrp);
    // Still the daemon's child: nothing unrefs it, so its exit is read.
    expect(sshEntry.ppid).toBe(process.pid);
    const code = await new Promise<number | null>((done) => child.on("close", done));
    expect(code).toBe(0);
    const leftover = Number(readFileSync(pidFile, "utf8").trim());
    const entry = await until(() => {
      const found = statOf(leftover);
      return found !== null && found.ppid !== pid ? found : null;
    });
    // Reparented, as the master is: no descendant of the daemon, and in ssh's group, not the daemon's.
    expect(entry.ppid).not.toBe(process.pid);
    expect(entry.pgrp).toBe(pid);
    expect(entry.pgrp).not.toBe(process.pid);
    expect(entry.pgrp).not.toBe(own?.pgrp);
  });

  it("settles at the deadline even while a process ssh left holds its output", async () => {
    const pidFile = join(scratch, "holder.pid");
    // The background sleep keeps ssh's stdout open after ssh itself is killed.
    const ssh = fakeSsh("ssh-holds", `sleep 30 &\necho $! > ${JSON.stringify(pidFile)}\nwait`);
    const before = timers();
    const started = Date.now();
    const result = await sshRun({ destination: "box", ssh }, "true", { deadlineMs: 300 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.code).toBeNull();
    expect(result.failure).toBe("no answer within 300 ms");
    expect(timers()).toBeLessThanOrEqual(before);
    const holder = Number(readFileSync(pidFile, "utf8").trim());
    const entry = statOf(holder);
    // Only ssh was killed: what it left in its group is not, as a shared master must not be.
    expect(entry).not.toBeNull();
    if (entry !== null) groups.push(entry.pgrp);
  });

  it("kills a hung ssh on abort, resolving at once and leaving no timer", async () => {
    const ssh = fakeSsh("ssh-hangs", "exec sleep 30");
    const controller = new AbortController();
    const before = timers();
    const running = sshRun({ destination: "box", ssh }, "true", {
      deadlineMs: 60_000,
      signal: controller.signal,
    });
    await new Promise((done) => setTimeout(done, 100));
    controller.abort();
    const result = await running;
    expect(result).toMatchObject({ code: null, failure: "aborted" });
    expect(timers()).toBeLessThanOrEqual(before);
  });
});
