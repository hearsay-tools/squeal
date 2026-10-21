import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsSource } from "../../src/core/ps/source.js";
import {
  ALPHA_ID,
  ALPHA_MARK,
  BETA_ID,
  BETA_MARK,
  BOOT_SECONDS,
  cpuTicksOf,
  PROCESSES,
  SS_XLE,
  startTicksOf,
  writeTree,
} from "./fixture.js";

/*
 * Spec 014 D2, D4, D5, D6, D11 (task 014-04): the Linux source over fixture
 * `/proc` trees built from the 014-02 probe logs. Every read is of a file
 * under the root; none throws for a process that left or a file it may not
 * read.
 */

const isRoot = process.getuid?.() === 0;
let root: string;
let source: PsSource;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-ps-proc-"));
  writeTree(root);
  source = createProcSource({ root, availableParallelism: () => 24 });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fixture = (pid: number) => {
  const p = PROCESSES.find((q) => q.pid === pid);
  if (p === undefined) throw new Error(`no fixture process ${pid}`);
  return p;
};

describe("process table", () => {
  test("reads every process's stat fields, and only the numbered directories that hold one", () => {
    const table = source.processTable();
    expect([...table.keys()].sort((a, b) => a - b)).toEqual(
      PROCESSES.map((p) => p.pid).sort((a, b) => a - b),
    );
    const daemon = fixture(349493);
    expect(table.get(349493)).toEqual({
      pid: 349493,
      ppid: 1049,
      pgid: 349493,
      comm: "MainThread",
      state: "S",
      startTicks: startTicksOf(daemon),
      cpuTicks: cpuTicksOf(daemon).utime + cpuTicksOf(daemon).stime,
      nice: 0,
      uid: process.getuid?.() ?? null,
    });
    expect(table.get(2353452)).toMatchObject({ ppid: 2091490, pgid: 2091490, nice: 10 });
  });

  test("a command name with spaces and parentheses ends at the last parenthesis", () => {
    expect(source.processTable().get(777)).toMatchObject({
      comm: "x) y (z",
      state: "T",
      ppid: 1049,
      nice: -5,
    });
  });

  test("with pids, reads only those, and a missing one is absent", () => {
    const table = source.processTable([2353452, 4242, 99999]);
    expect([...table.keys()]).toEqual([2353452]);
  });

  test("an unreadable or garbled stat is absent, never a throw", () => {
    mkdirSync(join(root, "proc", "5000"));
    writeFileSync(join(root, "proc", "5000", "stat"), "garbage");
    mkdirSync(join(root, "proc", "5001"));
    writeFileSync(join(root, "proc", "5001", "stat"), "5001 (sh) S x y z\n");
    const table = source.processTable();
    expect(table.has(5000)).toBe(false);
    expect(table.has(5001)).toBe(false);
  });

  test("an empty table when /proc is missing", () => {
    expect(createProcSource({ root: join(root, "nowhere") }).processTable().size).toBe(0);
  });
});

describe("per-process reads", () => {
  test("cmdline splits the arguments; a kernel thread has none; a missing process is null", () => {
    expect(source.cmdline(349493)).toEqual(fixture(349493).cmdline);
    expect(source.cmdline(2)).toEqual([]);
    expect(source.cmdline(99999)).toBeNull();
  });

  test("markOf returns the SQUEAL_DAEMON_CHILD value wherever it sits in the environment", () => {
    expect(source.markOf(2353452)).toBe(BETA_MARK);
    expect(source.markOf(2242955)).toBe(ALPHA_MARK);
  });

  test("markOf is null without the variable, without an environ, and for a missing process", () => {
    expect(source.markOf(349493)).toBeNull();
    expect(source.markOf(2353500)).toBeNull();
    expect(source.markOf(2)).toBeNull();
    expect(source.markOf(99999)).toBeNull();
  });

  test.skipIf(isRoot)("markOf is null for an environ it may not read, as another user's", () => {
    expect(source.markOf(1200)).toBeNull();
  });

  test("markOf never returns, nor writes anywhere, another environment value", () => {
    const writes = [vi.spyOn(process.stdout, "write"), vi.spyOn(process.stderr, "write")];
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    try {
      // Root reads a mode-000 environ, so the unreadable fixture has no fixed answer there.
      const checked = PROCESSES.filter((p) => !(isRoot && p.environ === "unreadable"));
      const marks = checked.map((p) => source.markOf(p.pid));
      for (const [i, p] of checked.entries()) {
        const env = typeof p.environ === "object" && p.environ !== null ? p.environ : {};
        expect(marks[i]).toBe(env.SQUEAL_DAEMON_CHILD ?? null);
      }
      for (const spy of [...writes, ...logs]) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [...writes, ...logs]) spy.mockRestore();
    }
  });

  test("memory is RssAnon + RssShmem and VmSwap in bytes; a kernel thread has none", () => {
    expect(source.memory(349493)).toEqual({ bytes: 102_608 * 1024, swapBytes: 0 });
    expect(source.memory(2091490)).toEqual({
      bytes: (665_208 + 512) * 1024,
      swapBytes: 2_048 * 1024,
    });
    expect(source.memory(2242955)).toEqual({ bytes: (81_000 + 26_000) * 1024, swapBytes: 0 });
    expect(source.memory(2)).toBeNull();
    expect(source.memory(99999)).toBeNull();
  });

  test("fds lists the lock file, the store and the socket of a daemon", () => {
    expect(source.fds(349493)).toEqual([
      "/dev/null",
      `/home/user/projects/alpha/.git/squeal/locks/${ALPHA_ID}.sqlite`,
      "/home/user/projects/alpha/.git/squeal/store.sqlite",
      "socket:[1057291937]",
    ]);
    expect(source.fds(2091490)).toEqual([
      `/home/user/projects/beta/.git/squeal/locks/${BETA_ID}.sqlite`,
    ]);
    expect(source.fds(2)).toEqual([]);
    expect(source.fds(99999)).toBeNull();
  });

  test("cwds gives each readable working directory and leaves out the rest", () => {
    const cwds = source.cwds([349493, 2091490, 2, 99999]);
    expect(cwds).toEqual(
      new Map([
        [349493, "/home/user/projects/alpha/.git/squeal"],
        [2091490, "/home/user/projects/beta"],
      ]),
    );
  });

  test("a process that leaves between the table and the next read reads as null, never a throw", () => {
    expect(source.processTable().has(2353452)).toBe(true);
    rmSync(join(root, "proc", "2353452"), { recursive: true });
    expect(source.cmdline(2353452)).toBeNull();
    expect(source.markOf(2353452)).toBeNull();
    expect(source.memory(2353452)).toBeNull();
    expect(source.fds(2353452)).toBeNull();
    expect(source.cwds([2353452])?.size ?? 0).toBe(0);
    expect(source.processTable([2353452]).size).toBe(0);
  });
});

describe("locks and listeners", () => {
  test("locks parses held and blocked entries, and an OFD lock has no pid", () => {
    expect(source.locks()).toEqual([
      { kind: "POSIX", access: "write", pid: 349493, file: "103:02:537238177", blocked: false },
      { kind: "POSIX", access: "write", pid: 2091490, file: "103:02:537238177", blocked: true },
      { kind: "POSIX", access: "read", pid: 2091490, file: "103:02:578571566", blocked: false },
      { kind: "OFDLCK", access: "write", pid: null, file: "00:2c:1234", blocked: false },
      { kind: "FLOCK", access: "write", pid: 1200, file: "00:2c:99", blocked: false },
    ]);
  });

  test("locks is null without /proc/locks", () => {
    unlinkSync(join(root, "proc", "locks"));
    expect(source.locks()).toBeNull();
  });

  test("unixListeners runs ss -xle and ties each bound name to its socket and file inode", () => {
    const run = vi.fn(() => SS_XLE);
    const listeners = createProcSource({ root, run }).unixListeners();
    expect(run).toHaveBeenCalledWith("ss", ["-xle"]);
    expect(listeners).toEqual([
      { path: "/run/user/1000/.201327086831dfaa", socketInode: 1057291937, fileInode: 325632 },
      {
        path: "/tmp/squeal-1000/tmp/1e2484abf6bcdf96/cez ci/ipc",
        socketInode: 205499193,
        fileInode: 1087533839,
      },
    ]);
  });

  test("unixListeners is null without ss", () => {
    expect(createProcSource({ root, run: () => null }).unixListeners()).toBeNull();
  });

  test("fileKey is null for a missing file", () => {
    expect(source.fileKey(join(root, "missing.lock"))).toBeNull();
  });
});

describe("host", () => {
  test("reads load, pressure, memory, swap and CPU time, in bytes and percent", () => {
    expect(source.host()).toEqual({
      load: [43.21, 36.57, 38.82],
      cpuPressure: 45.57,
      memoryPressure: { some: 0.64, full: 0.52 },
      memTotal: 49_223_972 * 1024,
      memAvailable: 16_890_700 * 1024,
      swapTotal: 4_194_300 * 1024,
      swapUsed: (4_194_300 - 144) * 1024,
      cpuTime: { busy: 9_000_000 + 500_000 + 2_000_000 + 100_000, total: 15_000_000 },
      cpus: 24,
    });
  });

  test("a kernel without pressure files reads null pressure and the rest as before", () => {
    rmSync(join(root, "proc", "pressure"), { recursive: true });
    const host = source.host();
    expect(host.cpuPressure).toBeNull();
    expect(host.memoryPressure).toBeNull();
    expect(host.load).toEqual([43.21, 36.57, 38.82]);
  });

  test("an empty root reads every host value as null", () => {
    expect(
      createProcSource({ root: join(root, "nowhere"), availableParallelism: () => 2 }).host(),
    ).toEqual({
      load: null,
      cpuPressure: null,
      memoryPressure: null,
      memTotal: null,
      memAvailable: null,
      swapTotal: null,
      swapUsed: null,
      cpuTime: null,
      cpus: 2,
    });
  });

  test("boot time, clock ticks and the PID namespace", () => {
    expect(source.bootTime()).toBe(BOOT_SECONDS * 1000);
    expect(source.clockTicks()).toBe(100);
    expect(source.pidNamespace()).toBe("pid:[4026531836]");
    const empty = createProcSource({ root: join(root, "nowhere") });
    expect(empty.bootTime()).toBeNull();
    expect(empty.pidNamespace()).toBeNull();
  });

  test("names its platform and what it measures", () => {
    expect(source).toMatchObject({ platform: "linux", memoryKind: "private", readsMarks: true });
  });
});
