import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createDarwinSource, type DarwinOs } from "../../src/core/ps/darwin.js";
import { discover, phaseOn } from "../../src/core/ps/discover.js";
import { cpuShare, hostTotals } from "../../src/core/ps/host.js";
import { measure } from "../../src/core/ps/measure.js";
import type { DaemonWork, PsPlaces, Sample } from "../../src/core/ps/model.js";
import { type CommandRunner, type PsSource, ticksToMs } from "../../src/core/ps/source.js";

/*
 * Spec 014 D10 (task 014-12): the macOS source over fixture outputs of `ps`,
 * `vm_stat`, `sysctl` and `lsof` and injected `node:os` reads. Nothing here
 * runs on a Mac or spawns a command: the runner is a fake that records what
 * it was asked to run.
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "darwin");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const PS = ["-axww", "-o", "pid=,ppid=,pgid=,uid=,nice=,time=,rss=,lstart=,command="];
const PS_CALL = ["env", "-u", "LC_ALL", "LC_TIME=C", "ps", ...PS].join(" ");

/** Local time, as `ps` prints `lstart` in the time zone it shares with Node. */
const local = (month: number, day: number, h: number, m: number, s: number): number =>
  new Date(2026, month - 1, day, h, m, s).getTime();
const BOOT = local(10, 13, 8, 0, 0);
const NOW = local(10, 21, 10, 21, 0) + 437;

interface Fake {
  readonly source: PsSource;
  readonly calls: string[];
  /** The next `ps` read's output; `null` fails it. */
  ps: string | null;
  vmStat: string | null;
  swap: string | null;
  lsof: string | null;
  /** Each CPU's times in ms, which `cpus()` returns. */
  cpuMs: { user: number; nice: number; sys: number; idle: number; irq: number };
}

function fake(os: Partial<DarwinOs> = {}): Fake {
  const state: Omit<Fake, "source"> = {
    calls: [],
    ps: fixture("ps-1.txt"),
    vmStat: fixture("vm_stat.txt"),
    swap: fixture("swapusage.txt"),
    lsof: fixture("lsof-cwd.txt"),
    cpuMs: { user: 40_000, nice: 0, sys: 10_000, idle: 150_000, irq: 0 },
  };
  const run: CommandRunner = (command, args) => {
    const call = [command, ...args].join(" ");
    state.calls.push(call);
    if (call === PS_CALL) return state.ps;
    if (call === "vm_stat") return state.vmStat;
    if (call === "sysctl -n vm.swapusage") return state.swap;
    if (call === "lsof -d cwd -F pn") return state.lsof;
    throw new Error(`unexpected command: ${call}`);
  };
  const source = createDarwinSource({
    run,
    now: () => NOW,
    os: {
      loadavg: () => [3.25, 2.5, 1.75],
      totalmem: () => 16 * 1024 ** 3,
      cpus: () => [{ times: { ...state.cpuMs } }, { times: { ...state.cpuMs } }],
      availableParallelism: () => 8,
      uptime: () => Math.floor(NOW / 1000) - BOOT / 1000,
      ...os,
    },
  });
  return Object.assign(state, { source });
}

let f: Fake;
beforeEach(() => {
  f = fake();
});

describe("process table: one ps per read", () => {
  test("parses every column of a row, its start as ticks after the boot time", () => {
    const table = f.source.processTable();
    expect([...table.keys()]).toEqual([1, 612, 4810, 5120, 5233, 5240, 5301, 8120, 6001, 7002]);
    expect(f.source.bootTime()).toBe(BOOT);
    expect(f.source.clockTicks()).toBe(100);
    expect(table.get(4810)).toEqual({
      pid: 4810,
      ppid: 1,
      pgid: 4810,
      comm: "node",
      state: null,
      startTicks: (local(10, 21, 9, 40, 7) - BOOT) / 10,
      cpuTicks: 6_231,
      nice: 0,
      uid: 501,
    });
    // Minutes past 59 and a negative nice; a day `%e` pads with a space.
    expect(table.get(6001)).toMatchObject({ ppid: 5998, nice: -5, cpuTicks: 750_740 });
    expect(table.get(7002)?.startTicks).toBe((local(10, 7, 9, 5, 0) - BOOT) / 10);
    expect(f.calls).toEqual([PS_CALL]);
  });

  test("each row's start and the boot time agree to the second lstart prints", () => {
    const ticks = f.source.clockTicks();
    const boot = f.source.bootTime() ?? Number.NaN;
    const starts = [...f.source.processTable().values()].map(
      (row) => boot + ticksToMs(row.startTicks, ticks),
    );
    expect(starts).toEqual([
      local(10, 13, 8, 1, 12),
      local(10, 13, 8, 1, 40),
      local(10, 21, 9, 40, 7),
      local(10, 21, 10, 15, 51),
      local(10, 21, 10, 20, 2),
      local(10, 21, 10, 20, 5),
      local(10, 21, 10, 20, 6),
      local(10, 21, 8, 55, 30),
      local(10, 15, 14, 2, 33),
      local(10, 7, 9, 5, 0),
    ]);
  });

  test("each row has its owner's uid: root's, the user's and another user's", () => {
    const table = f.source.processTable();
    expect([1, 4810, 8120].map((pid) => table.get(pid)?.uid)).toEqual([0, 501, 502]);
  });

  test("only `pids`, still from one ps; none asked for is no read at all", () => {
    expect([...f.source.processTable([5233, 9999, 4810]).keys()].sort()).toEqual([4810, 5233]);
    expect(f.source.processTable([]).size).toBe(0);
    expect(f.calls).toEqual([PS_CALL]);
  });

  test("a malformed line is skipped, the others kept", () => {
    f.ps = fixture("ps-malformed.txt");
    const table = f.source.processTable();
    // A header, a blank line, a cut line, a `-` time and RSS, a bad month, a bad day.
    expect([...table.keys()]).toEqual([4810, 816, 5233]);
    expect(f.source.cmdline(816)).toBeNull();
    expect(table.get(816)?.comm).toBe("");
  });

  test("a failed ps throws, never an empty host; a ps that lists nothing is an empty table (reviews/wave-2.md B4)", () => {
    f.ps = null;
    expect(() => f.source.processTable()).toThrow(
      "the process table cannot be read: ps failed, is missing or timed out",
    );
    f.ps = "";
    expect(f.source.processTable().size).toBe(0);
    expect(f.source.cmdline(4810)).toBeNull();
    expect(f.source.memory(4810)).toBeNull();
  });
});

describe("arguments and memory: of the last table read", () => {
  test("the command split at each space, an empty argument kept", () => {
    f.source.processTable();
    expect(f.source.cmdline(5120)).toEqual([
      "node",
      "/Users/user/.codex/plugins/cache/hearsay/squeal/0.1.237/dist/cli/squeal.mjs",
      "daemon",
      "/Users/user/projects/beta",
      "--await-lock",
    ]);
    expect(f.source.cmdline(5240)).toEqual(["git", "status", "--porcelain", "", "-z"]);
    // `command` joins the arguments with spaces: one that holds a space is split (D10, inferred).
    expect(f.source.cmdline(6001)?.[0]).toBe("/Applications/Google");
    expect(f.source.cmdline(9999)).toBeNull();
    expect(f.calls).toEqual([PS_CALL]);
  });

  test("before any table read, nothing is known", () => {
    expect(f.source.cmdline(4810)).toBeNull();
    expect(f.source.memory(4810)).toBeNull();
    expect(f.calls).toEqual([]);
  });

  test("memory is RSS in bytes, labelled rss, with no swap", () => {
    f.source.processTable();
    expect(f.source.memoryKind).toBe("rss");
    expect(f.source.memory(5233)).toEqual({ bytes: 153_188 * 1024, swapBytes: null });
    expect(f.source.memory(5301)).toEqual({ bytes: 0, swapBytes: null });
  });
});

describe("the window: CPU from time= over two reads", () => {
  test("measure gives each process its CPU over the window, never %cpu", () => {
    const first: Sample = { atMs: 0, table: f.source.processTable(), cpuTime: null };
    f.ps = fixture("ps-2.txt");
    const second: Sample = { atMs: 2_000, table: f.source.processTable(), cpuTime: null };
    const costs = measure(f.source, first, second, [4810, 5120, 5233, 5240, 5301]);
    expect(costs.get(5233)).toEqual({
      cpuPct: 90,
      cpuMs: 4_920,
      privateBytes: 160_000 * 1024,
      swapBytes: null,
    });
    expect(costs.get(5120)?.cpuPct).toBe(50);
    expect(costs.get(4810)?.cpuPct).toBe(1);
    // Pid 5240 is another process in the second read: its start differs.
    expect(costs.get(5240)).toMatchObject({ cpuPct: null, cpuMs: 20, privateBytes: null });
    expect(costs.get(5301)).toMatchObject({ cpuPct: null, privateBytes: null });
  });
});

describe("host: os functions, vm_stat and sysctl", () => {
  test("load, CPUs, used memory from vm_stat and swap; no pressure", () => {
    const host = f.source.host();
    const used = (420_046 - 12_345 + 154_321 + 187_654) * 16_384;
    expect(host).toEqual({
      load: [3.25, 2.5, 1.75],
      cpuPressure: null,
      memoryPressure: null,
      memTotal: 16 * 1024 ** 3,
      memAvailable: 16 * 1024 ** 3 - used,
      swapTotal: 2048 * 1024 ** 2,
      swapUsed: 1385.25 * 1024 ** 2,
      cpuTime: { busy: 2 * 5_000, total: 2 * 20_000 },
      cpus: 8,
    });
    expect(f.calls).toEqual(["vm_stat", "sysctl -n vm.swapusage"]);
  });

  test("the busy CPU of two readings is in clock ticks, as the shares read it", () => {
    const first: Sample = { atMs: 0, table: new Map(), cpuTime: f.source.host().cpuTime };
    const h1 = f.source.host();
    f.cpuMs = { user: 41_200, nice: 0, sys: 10_400, idle: 150_400, irq: 0 };
    const second: Sample = { atMs: 2_000, table: new Map(), cpuTime: f.source.host().cpuTime };
    // Each of 2 CPUs was busy 1.6 s of 2 s: 160% of one CPU, 80% of the host.
    expect(hostTotals(h1, f.source.host()).busyCpuPct).toBe(80);
    expect(cpuShare(80, first, second, f.source.clockTicks())).toBe(50);
  });

  test("a failed or malformed vm_stat or sysctl reads null, the rest kept", () => {
    f.vmStat = null;
    f.swap = "vm.swapusage: unavailable";
    expect(f.source.host()).toMatchObject({
      memTotal: 16 * 1024 ** 3,
      memAvailable: null,
      swapTotal: null,
      swapUsed: null,
      load: [3.25, 2.5, 1.75],
    });
    f.vmStat = fixture("vm_stat.txt").replace(/^Mach.*\n/, "");
    expect(f.source.host().memAvailable).toBeNull();
    f.vmStat = fixture("vm_stat.txt").replace(/^Anonymous pages:.*\n/m, "");
    expect(f.source.host().memAvailable).toBeNull();
    f.swap = null;
    expect(f.source.host()).toMatchObject({ swapTotal: null, swapUsed: null });
    f.swap = "total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)";
    expect(f.source.host()).toMatchObject({ swapTotal: 0, swapUsed: 0 });
  });

  test("no CPUs or a short load average read null", () => {
    const g = fake({ cpus: () => [], loadavg: () => [] });
    expect(g.source.host()).toMatchObject({ cpuTime: null, load: null });
  });
});

describe("working directories: one lsof", () => {
  test("those of `pids` that lsof names", () => {
    const cwds = f.source.cwds([5233, 4810, 9999]);
    expect(cwds).toEqual(
      new Map([
        [4810, "/Users/user/projects/alpha/.git/squeal"],
        [5233, "/private/var/folders/xy/1b2c3d4e5f/T/squeal-vitest-0aB3"],
      ]),
    );
    expect(f.source.cwds([6001])?.get(6001)).toBe(
      "/Users/user/Library/Application Support/Google/Chrome",
    );
    expect(f.calls).toEqual(["lsof -d cwd -F pn", "lsof -d cwd -F pn"]);
  });

  test("a failed lsof is null; no pids is no spawn; stray lines are skipped", () => {
    expect(f.source.cwds([])).toEqual(new Map());
    expect(f.calls).toEqual([]);
    f.lsof = null;
    expect(f.source.cwds([4810])).toBeNull();
    f.lsof = "n/orphan\npx\nn/not-a-pid\np42\nftxt\nn/usr/bin/x\nfcwd\nn/home\nlwarning\n";
    expect(f.source.cwds([42])).toEqual(new Map([[42, "/home"]]));
  });
});

describe("what the source cannot read (D10)", () => {
  test("marks, fds, locks, file keys, listeners and the PID namespace are null, without a spawn", () => {
    f.source.processTable();
    f.calls.length = 0;
    expect(f.source.platform).toBe("darwin");
    expect(f.source.readsMarks).toBe(false);
    expect(f.source.markOf(5233)).toBeNull();
    expect(f.source.fds(4810)).toBeNull();
    expect(f.source.locks()).toBeNull();
    expect(f.source.fileKey("/Users/user/projects/alpha/.git/squeal/locks/x.sqlite")).toBeNull();
    expect(f.source.unixListeners()).toBeNull();
    expect(f.source.pidNamespace()).toBeNull();
    expect(f.source.processTable().get(4810)?.state).toBeNull();
    expect(f.calls).toEqual([PS_CALL]);
  });

  test("an unreadable uptime is no boot time", () => {
    expect(fake({ uptime: () => Number.NaN }).source.bootTime()).toBeNull();
  });
});

describe("the stages over it, unchanged", () => {
  let base: string;
  let root: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "squeal-ps-darwin-"));
    root = join(base, "alpha");
    mkdirSync(join(root, ".git"), { recursive: true });
    f.ps = fixture("ps-1.txt").replaceAll("/Users/user/projects/alpha", root);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const places = (): PsPlaces => ({
    uid: 501,
    home: "/Users/user",
    userConfig: join(base, "config.json"),
    runtimeDir: null,
    tempDir: join(base, "tmp"),
    commonDir: null,
  });
  const work = (startedAt: number, heartbeatAt: number): DaemonWork => ({
    record: {
      socketPath: join(base, "tmp", "squeal.sock"),
      startedAt,
      heartbeatAt,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.1.238",
    },
    recordedStartedAt: startedAt,
    token: null,
    pending: 0,
    running: 0,
    tiers: [],
    checkpoints: [],
    consumers: [],
    departedAt: null,
    slowWaiting: false,
    lastUse: null,
    settings: { idleExitMinutes: 60, unusedExitMinutes: 30, timeoutMs: 600_000 },
  });

  test("discover finds the daemons by their arguments, their id by the root's hash, no lock state", () => {
    const found = discover(f.source, f.source.processTable(), places());
    expect(found.daemons.map((d) => d.row.pid)).toEqual([4810, 5120]);
    const [alpha, beta] = found.daemons;
    expect(alpha).toMatchObject({
      root,
      version: "0.1.238",
      harness: "claude",
      worktreeId: worktreeIdFor(root),
      idFrom: "root-hash",
      holdsLock: null,
      awaitLock: false,
    });
    expect(beta).toMatchObject({ version: "0.1.237", harness: "codex", awaitLock: true });
    expect(found.unknown.map((u) => u.what)).toContain("daemon lock holders");
  });

  test("discover leaves another user's daemon out, and finds it for that user", () => {
    const table = f.source.processTable();
    expect(discover(f.source, table, places()).daemons.map((d) => d.row.pid)).not.toContain(8120);
    const other = discover(f.source, table, { ...places(), uid: 502 });
    expect(other.daemons.map((d) => [d.row.pid, d.root])).toEqual([
      [8120, "/Users/other/projects/gamma"],
    ]);
  });

  test("phaseOn's start rule holds: its own fresh record serves, a predecessor's is unknown", () => {
    const daemon = discover(f.source, f.source.processTable(), places()).daemons[0];
    if (daemon === undefined) throw new Error("no daemon 4810");
    const start = local(10, 21, 9, 40, 7);
    const phase = phaseOn(f.source);
    // Registered 1.2 s after a start lstart printed to the second; within that second.
    expect(phase(daemon, work(start + 1_200, NOW - 3_000), NOW)).toBe("serving");
    expect(phase(daemon, work(start + 100, NOW - 3_000), NOW)).toBe("serving");
    expect(phase(daemon, work(start - 60_000, NOW - 3_000), NOW)).toBe("unknown");
    expect(phase(daemon, work(start + 1_200, NOW - 10_001), NOW)).toBe("unknown");
  });
});
