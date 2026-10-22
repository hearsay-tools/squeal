import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createProcSource } from "../../src/core/ps/proc.js";
import { runCommand } from "../../src/core/ps/source.js";

/*
 * Spec 014 D2, D4, D5 (task 014-04): the Linux source against this host's
 * own `/proc`, so the parsers meet the kernel's and `ss`'s real formats, not
 * only the fixtures'. It reads this test's process, a child it spawns and a
 * lock and a socket it holds; nothing of another process.
 */

const linux = process.platform === "linux";
const source = createProcSource();
let dir: string;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squeal-ps-live-"));
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!linux)("the Linux source on this host", () => {
  test("reads this process's row, memory and descriptors", () => {
    const row = source.processTable().get(process.pid);
    expect(row).toMatchObject({ pid: process.pid, ppid: process.ppid, uid: process.getuid?.() });
    expect(row?.startTicks).toBeGreaterThan(0);
    expect(source.processTable([process.pid]).get(process.pid)?.startTicks).toBe(row?.startTicks);
    expect(source.memory(process.pid)?.bytes).toBeGreaterThan(0);
    expect(source.fds(process.pid)?.length).toBeGreaterThan(0);
    expect(source.cmdline(process.pid)?.[0]).toBe(
      readFileSync("/proc/self/cmdline", "utf8").split("\0")[0],
    );
  });

  test("boot time agrees with /proc/uptime", () => {
    const uptimeMs = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
    expect(Math.abs((source.bootTime() ?? 0) - (Date.now() - uptimeMs))).toBeLessThan(2_000);
  });

  test("the key of a file this process locks is the key /proc/locks names it by", () => {
    const path = join(dir, "held.sqlite");
    const db = new DatabaseSync(path);
    cleanups.push(() => db.close());
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    const key = source.fileKey(path);
    expect(key).toMatch(/^[0-9a-f]{2,}:[0-9a-f]{2,}:\d+$/);
    const mine = (source.locks() ?? []).filter((l) => l.pid === process.pid && l.file === key);
    expect(mine.some((l) => l.access === "write" && l.kind === "POSIX" && !l.blocked)).toBe(true);
  });

  test("markOf reads a child's mark and nothing else of its environment", async () => {
    const child: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      env: {
        PATH: process.env.PATH ?? "",
        OTHER_SECRET: "do-not-print",
        SQUEAL_DAEMON_CHILD: "t0k3n:vitest#7",
      },
      stdio: "ignore",
    });
    cleanups.push(() => child.kill("SIGKILL"));
    const pid = child.pid ?? 0;
    // Until its exec, the child still has this process's environment.
    await waitFor(() => source.cmdline(pid)?.includes("-e") ?? false);
    expect(source.markOf(pid)).toBe("t0k3n:vitest#7");
    expect(source.processTable().get(pid)?.ppid).toBe(process.pid);
  });

  test.skipIf(runCommand("ss", ["-V"]) === null)(
    "ss -xle ties a listening socket file to its inode",
    async () => {
      const path = join(dir, "listen.sock");
      const server: Server = createServer();
      await new Promise<void>((resolve) => server.listen(path, resolve));
      cleanups.push(() => server.close());
      const inode = statSync(path).ino;
      expect(source.unixListeners()?.filter((l) => l.fileInode === inode)).toEqual([
        { fileInode: inode },
      ]);
    },
  );
});

async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
}
