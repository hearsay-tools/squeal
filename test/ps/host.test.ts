import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cpuShare, hostTotals, memoryShare, readPool } from "../../src/core/ps/host.js";
import type { PsPlaces } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { HostReading, LockEntry } from "../../src/core/ps/source.js";
import { takePermit } from "../../src/core/slow/index.js";
import { writeHost } from "./fixture.js";
import { fakeSource, HOST, sampleOf } from "./fixture-samples.js";

/*
 * Spec 014 D6 (task 014-07): the host totals over the window, Squeal's
 * shares of the busy CPU and the used memory, and the capacity pool's
 * permits by holder, from `/proc/locks`.
 */

const GIB = 2 ** 30;

describe("hostTotals", () => {
  test("the host's values at the end of the window, and its busy CPU over the window in percent of all its CPUs", () => {
    const first: HostReading = { ...HOST, load: [1, 1, 1], cpuPressure: 1 };
    // 24 CPUs for 2 s are 4,800 ticks, 4,416 of them busy.
    const second: HostReading = {
      ...HOST,
      cpuTime: { busy: 1_004_416, total: 1_104_800 },
    };
    expect(hostTotals(first, second)).toEqual({
      load: [36.8, 41.3, 51.1],
      cpus: 24,
      cpuPressure: 45.57,
      memoryPressure: { some: 0.64, full: 0.52 },
      memTotal: 47 * GIB,
      memAvailable: 14.3 * GIB,
      swapTotal: 4 * GIB,
      swapUsed: 4 * GIB,
      busyCpuPct: 92,
    });
  });

  test("what the source could not read stays null, never zero", () => {
    const blind: HostReading = {
      load: null,
      cpuPressure: null,
      memoryPressure: null,
      memTotal: null,
      memAvailable: null,
      swapTotal: null,
      swapUsed: null,
      cpuTime: null,
      cpus: 8,
    };
    expect(hostTotals(blind, blind)).toEqual({
      load: null,
      cpus: 8,
      cpuPressure: null,
      memoryPressure: null,
      memTotal: null,
      memAvailable: null,
      swapTotal: null,
      swapUsed: null,
      busyCpuPct: null,
    });
    expect(hostTotals(HOST, { ...HOST, cpuTime: null }).busyCpuPct).toBeNull();
    // No tick between the readings: no window to measure over.
    expect(hostTotals(HOST, HOST).busyCpuPct).toBeNull();
  });

  test("over the Linux source's host files", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-ps-host-"));
    try {
      writeHost(root);
      const source = createProcSource({ root, availableParallelism: () => 24 });
      const reading = source.host();
      const later: HostReading = {
        ...reading,
        cpuTime: {
          busy: (reading.cpuTime?.busy ?? 0) + 2_200,
          total: (reading.cpuTime?.total ?? 0) + 4_800,
        },
      };
      expect(hostTotals(reading, later)).toMatchObject({
        load: [43.21, 36.57, 38.82],
        cpus: 24,
        cpuPressure: 45.57,
        memoryPressure: { some: 0.64, full: 0.52 },
        memTotal: 49_223_972 * 1024,
        memAvailable: 16_890_700 * 1024,
        swapUsed: (4_194_300 - 144) * 1024,
      });
      expect(hostTotals(reading, later).busyCpuPct).toBeCloseTo(45.83, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Squeal's shares", () => {
  test("the CPU share is Squeal's CPU over the window against the host's busy CPU in the same window", () => {
    // 22 CPUs busy for 2 s are 4,400 ticks: 2,200% of one CPU. Squeal used 810% of it.
    const first = sampleOf(1_000, [], { busy: 1_000_000, total: 1_100_000 });
    const second = sampleOf(3_000, [], { busy: 1_004_400, total: 1_104_800 });
    expect(cpuShare(810, first, second, 100)).toBeCloseTo((810 / 2_200) * 100);
  });

  test("the CPU share is null without Squeal's CPU, without the host's, or without a busy tick", () => {
    const first = sampleOf(1_000, [], { busy: 1_000_000, total: 1_100_000 });
    const second = sampleOf(3_000, [], { busy: 1_004_400, total: 1_104_800 });
    expect(cpuShare(null, first, second, 100)).toBeNull();
    expect(cpuShare(810, first, sampleOf(3_000, [], null), 100)).toBeNull();
    expect(cpuShare(810, first, sampleOf(3_000, [], first.cpuTime), 100)).toBeNull();
  });

  test("the memory share is Squeal's private memory over MemTotal - MemAvailable; swap stays apart", () => {
    const host = hostTotals(HOST, HOST);
    expect(memoryShare(21 * GIB, host)).toBeCloseTo((21 / (47 - 14.3)) * 100);
    expect(memoryShare(null, host)).toBeNull();
    expect(memoryShare(21 * GIB, { ...host, memAvailable: null })).toBeNull();
    expect(memoryShare(21 * GIB, { ...host, memAvailable: host.memTotal })).toBeNull();
  });
});

describe("readPool", () => {
  let dir: string;
  let places: PsPlaces;
  let runtimePool: string;
  let tempPool: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "squeal-ps-pool-"));
    places = {
      uid: 1000,
      home: join(dir, "home"),
      userConfig: join(dir, "xdg", "squeal", "config.json"),
      runtimeDir: join(dir, "run"),
      tempDir: join(dir, "tmp"),
      commonDir: null,
    };
    runtimePool = join(dir, "run", "squeal");
    tempPool = join(dir, "tmp", "squeal-1000");
    for (const pool of [runtimePool, tempPool]) mkdirSync(pool, { recursive: true });
    const names = [
      "pool.0.lock",
      "pool.1.lock",
      "pool.2.lock",
      "pool.0.lock-journal",
      "pool.mark.1e2484abf6bcdf96",
      "slow.lock",
      "slow.1.lock",
      "slow.wait.0123456789abcdef",
    ];
    for (const name of names) writeFileSync(join(runtimePool, name), "");
    writeFileSync(join(tempPool, "pool.0.lock"), "");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (pid: number, file: string, blocked = false): LockEntry => ({
    kind: "POSIX",
    access: "write",
    pid,
    file,
    blocked,
  });
  const keys = (): Record<string, string> => ({
    [join(runtimePool, "pool.0.lock")]: "103:02:10",
    [join(runtimePool, "pool.1.lock")]: "103:02:11",
    [join(runtimePool, "pool.2.lock")]: "103:02:12",
    [join(runtimePool, "pool.0.lock-journal")]: "103:02:13",
    [join(runtimePool, "slow.lock")]: "103:02:20",
    [join(runtimePool, "slow.1.lock")]: "103:02:21",
    [join(tempPool, "pool.0.lock")]: "103:02:30",
  });

  test("the permits each daemon holds, from the write locks of pool.<i>.lock and slow*.lock, and a holder that is no daemon", () => {
    const locks: LockEntry[] = [
      write(349493, "103:02:10"),
      write(349493, "103:02:11"),
      write(2091490, "103:02:12"),
      // Waiting behind the held lock: not a holder.
      write(777, "103:02:12", true),
      // A journal is no permit, whoever locks it.
      write(4242, "103:02:13"),
      write(2091490, "103:02:20"),
      // A shared read lock, as a check that a permit is free takes on its way: not the permit.
      { kind: "POSIX", access: "read", pid: 777, file: "103:02:21", blocked: false },
      write(4242, "103:02:30"),
      // An open file description lock names no process.
      { kind: "OFDLCK", access: "write", pid: null, file: "103:02:11", blocked: false },
    ];
    const { source } = fakeSource([], { locks, fileKeys: keys() });
    const reading = readPool(source, places, new Set([349493, 2091490]));
    expect(reading.pool).toEqual({ slots: 23, held: 5 });
    expect([...reading.permits]).toEqual([
      [349493, 2],
      [2091490, 2],
    ]);
    expect(reading.foreign).toEqual([{ pid: 4242, path: join(tempPool, "pool.0.lock") }]);
  });

  test("over the window's two readings, a permit either shows is held, by the holders of the latest that shows it (lessons.md P9)", () => {
    const first = [write(349493, "103:02:10"), write(349493, "103:02:11")];
    // pool.0 passed to 2091490, pool.2 is in the second reading only, and pool.1 in the first only.
    const second = [write(2091490, "103:02:10"), write(2091490, "103:02:12")];
    const { source } = fakeSource([], { locks: null, fileKeys: keys() });
    const reading = readPool(source, places, new Set([349493, 2091490]), [first, second]);
    expect(reading.pool).toEqual({ slots: 23, held: 3 });
    expect([...reading.permits]).toEqual([
      [2091490, 2],
      [349493, 1],
    ]);
  });

  test("a reading that cannot be read leaves the permits unknown, and a holder that is no daemon is still one (reviews/wave-5.md B1)", () => {
    const first = [write(349493, "103:02:10"), write(4242, "103:02:30")];
    const second = [write(349493, "103:02:11")];
    const { source } = fakeSource([], { locks: null, fileKeys: keys() });
    for (const readings of [
      [first, null],
      [null, second],
    ]) {
      const reading = readPool(source, places, new Set([349493]), readings);
      expect(reading.pool).toEqual({ slots: 23, held: null });
      expect(reading.permits.size).toBe(0);
      expect(reading.foreign).toEqual(
        readings[0] === null ? [] : [{ pid: 4242, path: join(tempPool, "pool.0.lock") }],
      );
    }
    expect(readPool(source, places, new Set([349493]), [null, null]).foreign).toEqual([]);
  });

  test("the host's slots are capacity.hostSlots of the user-level config file, else the CPUs less one", () => {
    // `PsPlaces.userConfig`, not the home directory: a user with `XDG_CONFIG_HOME` keeps their file.
    const configFile = places.userConfig;
    const { source } = fakeSource([], { locks: [], fileKeys: keys() });
    expect(readPool(source, places, new Set()).pool).toEqual({ slots: 23, held: 0 });
    mkdirSync(dirname(configFile), { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({
        capacity: { hostSlots: 12, projects: { "/home/user/projects/alpha": { slots: 4 } } },
      }),
    );
    expect(readPool(source, places, new Set()).pool).toEqual({ slots: 12, held: 0 });
    // A value the loader does not take is the default, as the daemons read it.
    writeFileSync(configFile, JSON.stringify({ capacity: { hostSlots: 0 } }));
    expect(readPool(source, places, new Set()).pool).toEqual({ slots: 23, held: 0 });
    writeFileSync(configFile, "{");
    expect(readPool(source, places, new Set()).pool).toEqual({ slots: 23, held: 0 });
  });

  test("without /proc/locks (D10) nobody's permits are known: held is null, not zero", () => {
    const { source } = fakeSource([], { locks: null, fileKeys: keys() });
    const reading = readPool(source, places, new Set([349493]));
    expect(reading.pool.held).toBeNull();
    expect(reading.permits.size).toBe(0);
    expect(reading.foreign).toEqual([]);
  });

  test("no pool directory holds no permit, and no runtime directory leaves the temp one", () => {
    rmSync(runtimePool, { recursive: true });
    const { source } = fakeSource([], { locks: [write(4242, "103:02:30")], fileKeys: keys() });
    const reading = readPool(source, { ...places, runtimeDir: null }, new Set());
    expect(reading.pool.held).toBe(1);
    expect(reading.foreign).toEqual([{ pid: 4242, path: join(tempPool, "pool.0.lock") }]);
  });

  test("over the Linux source, a fixture /proc/locks joined to the files' own keys", () => {
    const root = join(dir, "root");
    writeHost(root);
    const linux = createProcSource({ root, availableParallelism: () => 4 });
    const key = linux.fileKey(join(runtimePool, "pool.1.lock"));
    expect(key).not.toBeNull();
    const [major, minor, inode] = (key ?? "").split(":");
    writeFileSync(
      join(root, "proc", "locks"),
      `1: POSIX  ADVISORY  WRITE 349493 ${major}:${minor}:${inode} 1073741824 1073742335\n`,
    );
    const reading = readPool(linux, places, new Set([349493]));
    expect(reading.pool).toEqual({ slots: 3, held: 1 });
    expect([...reading.permits]).toEqual([[349493, 1]]);
  });

  test.skipIf(process.platform !== "linux")(
    "a permit this process holds as the pool takes it reads as this process's",
    () => {
      const db = takePermit(join(runtimePool, "pool.2.lock"), {
        pid: process.pid,
        worktreeId: "1e2484abf6bcdf96",
      });
      expect(db).not.toBeNull();
      try {
        const reading = readPool(createProcSource(), places, new Set([process.pid]));
        expect(reading.permits.get(process.pid)).toBe(1);
        expect(reading.foreign).toEqual([]);
      } finally {
        db?.close();
      }
      expect(readPool(createProcSource(), places, new Set([process.pid])).permits.size).toBe(0);
    },
  );
});
