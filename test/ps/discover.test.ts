import { rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { discover, lockedAgain, phaseOn } from "../../src/core/ps/discover.js";
import type { DaemonWork, FoundDaemon } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import type { PsSource } from "../../src/core/ps/source.js";
import { BOOT_SECONDS, UPTIME_SECONDS, writeProcess } from "./fixture.js";
import {
  cacheScript,
  daemonProcess,
  type FixtureHost,
  type FixtureRepo,
  HOME,
  lockLine,
  makeHost,
  makeRepo,
  NODE,
  withoutLocks,
  writeLocks,
  writeProcesses,
} from "./fixture-stores.js";

/*
 * Spec 014 D2 (task 014-06): daemons found by one `stat` scan and their
 * command lines, tied to their worktree by the lock file they hold open,
 * their phase by `/proc/locks`, and the socket files by worktree id and
 * `ss -xle`. The `/proc` tree is a fixture; the repositories, lock files and
 * socket files are real files, so `fileKey` and `stat` meet them as on a host.
 */

let host: FixtureHost;
let alpha: FixtureRepo;
let beta: FixtureRepo;
let ss: string | null;
let source: PsSource;

beforeEach(() => {
  host = makeHost();
  alpha = makeRepo(host.base, "alpha");
  beta = makeRepo(host.base, "beta");
  ss = null;
  source = createProcSource({ root: host.base, run: () => ss });
});

afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

const key = (path: string): string => {
  const k = source.fileKey(path);
  if (k === null) throw new Error(`no key for ${path}`);
  return k;
};
const run = () => discover(source, source.processTable(), host.places);
const daemonOf = (pid: number): FoundDaemon => {
  const d = run().daemons.find((x) => x.row.pid === pid);
  if (d === undefined) throw new Error(`no daemon ${pid}`);
  return d;
};

describe("finding daemons (D2 step 1)", () => {
  test("reads the arguments of MainThread and node processes only", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 100, root: alpha.root, lockPath: alpha.lockPath }),
      daemonProcess({ pid: 101, root: beta.root, lockPath: beta.lockPath, comm: "node" }),
      // Its arguments look like a daemon's, but no Node main thread has this name.
      { ...daemonProcess({ pid: 102, root: alpha.root }), comm: "bash" },
      {
        pid: 103,
        ppid: 1,
        pgid: 103,
        comm: "git",
        nice: 0,
        ageS: 5,
        lifeCpuPct: 1,
        cmdline: ["git", "status"],
      },
    ]);
    const cmdline = vi.spyOn(source, "cmdline");
    const found = run().daemons.map((d) => d.row.pid);
    expect(found.sort()).toEqual([100, 101]);
    // Neither `bash` nor `git` is read.
    expect(cmdline.mock.calls.map(([pid]) => pid).sort()).toEqual([100, 101]);
  });

  test("a daemon is a Squeal script followed by `daemon <root>`", () => {
    const node = (pid: number, cmdline: string[]) => ({
      pid,
      ppid: 1049,
      pgid: pid,
      comm: "MainThread",
      nice: 0,
      ageS: 60,
      lifeCpuPct: 1,
      cmdline,
    });
    writeProcesses(host, [
      node(200, [NODE, cacheScript("codex", "0.1.234"), "daemon", alpha.root]),
      node(201, [NODE, `${HOME}/src/squeal/dist/cli/index.js`, "daemon", alpha.root]),
      node(202, [`${HOME}/.local/bin/squeal`, "daemon", alpha.root]),
      // A status call, a test worker and a script of another name are not daemons.
      node(203, [NODE, cacheScript("codex", "0.1.234"), "status", alpha.root]),
      node(204, [NODE, `${HOME}/p/node_modules/vitest/dist/workers/forks.js`]),
      node(205, [NODE, `${HOME}/bin/not-squeal.mjs`, "daemon", alpha.root]),
      node(206, [NODE, "daemon", alpha.root]),
    ]);
    expect(
      run()
        .daemons.map((d) => [d.row.pid, d.script])
        .sort(),
    ).toEqual([
      [200, cacheScript("codex", "0.1.234")],
      [201, `${HOME}/src/squeal/dist/cli/index.js`],
      [202, `${HOME}/.local/bin/squeal`],
    ]);
  });

  test("only the user's own daemons", () => {
    const mine = daemonProcess({ pid: 300, root: alpha.root });
    writeProcesses(host, [mine]);
    const other = { ...host.places, uid: host.places.uid + 1 };
    expect(discover(source, source.processTable(), other).daemons).toEqual([]);
  });
});

describe("identity (D2)", () => {
  test("the version and harness come from a plugin cache path; a checkout's dist has neither", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 400, root: alpha.root, script: cacheScript("codex", "0.1.234") }),
      daemonProcess({ pid: 401, root: alpha.root, script: cacheScript("claude", "0.1.235") }),
      daemonProcess({ pid: 402, root: alpha.root, script: `${HOME}/squeal/dist/cli/squeal.mjs` }),
      daemonProcess({
        pid: 403,
        root: alpha.root,
        script: `${HOME}/.pi/agent/npm/node_modules/squeal-pi/dist/cli/squeal.mjs`,
      }),
    ]);
    const by = new Map(run().daemons.map((d) => [d.row.pid, [d.harness, d.version]]));
    expect(by.get(400)).toEqual(["codex", "0.1.234"]);
    expect(by.get(401)).toEqual(["claude", "0.1.235"]);
    expect(by.get(402)).toEqual([null, null]);
    expect(by.get(403)).toEqual(["pi", null]);
  });

  test("the root and --await-lock from the arguments; a relative root is null", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 410, root: alpha.root, awaitLock: true }),
      daemonProcess({ pid: 411, root: ".", lockPath: beta.lockPath }),
    ]);
    expect(daemonOf(410)).toMatchObject({ root: alpha.root, awaitLock: true });
    expect(daemonOf(411)).toMatchObject({ root: null, awaitLock: false, worktreeId: beta.id });
  });

  test("the worktree id, store and repository come from the lock file it holds open", () => {
    // The root argument names alpha; the lock fd wins, as it covers a relative or moved root.
    writeProcesses(host, [daemonProcess({ pid: 420, root: alpha.root, lockPath: beta.lockPath })]);
    expect(daemonOf(420)).toMatchObject({
      worktreeId: beta.id,
      lockPath: beta.lockPath,
      commonDir: beta.commonDir,
      storePath: beta.storePath,
    });
  });

  test("without the fd, the hash of the root and its common dir", () => {
    writeProcesses(host, [daemonProcess({ pid: 430, root: alpha.root })]);
    expect(daemonOf(430)).toMatchObject({
      worktreeId: alpha.id,
      lockPath: alpha.lockPath,
      commonDir: alpha.commonDir,
      storePath: alpha.storePath,
    });
  });

  test("with neither, the id is null and unknown says why", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 440, root: join(host.base, "gone") }),
      daemonProcess({ pid: 441, root: "." }),
    ]);
    const discovery = run();
    for (const d of discovery.daemons) {
      expect(d).toMatchObject({ worktreeId: null, lockPath: null, storePath: null });
    }
    expect(discovery.unknown).toEqual([
      { what: "daemon 440 worktreeId", why: expect.stringContaining("cannot be read") },
      { what: "daemon 441 worktreeId", why: expect.stringContaining("relative") },
    ]);
  });
});

describe("phases (D2 step 3 and its table)", () => {
  /** Daemon 500's start in epoch ms: the fixture's boot time plus its start ticks. */
  const START = (BOOT_SECONDS + UPTIME_SECONDS - 600) * 1000;
  const NOW = START + 600_000;
  const record = (startedAt: number, heartbeatAt = NOW - 1_000) => ({
    socketPath: "/run/user/1000/squeal-x.sock",
    startedAt,
    heartbeatAt,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.1.235",
  });
  type Recorded = DaemonWork["record"];
  const work = (r: Recorded, recordedStartedAt = r?.startedAt ?? null): DaemonWork => ({
    record: r,
    recordedStartedAt,
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
  /** Daemon 500, holding alpha's lock unless `held` is false. */
  const holder = (on: PsSource = source, held = true): FoundDaemon => {
    writeProcesses(host, [daemonProcess({ pid: 500, root: alpha.root, lockPath: alpha.lockPath })]);
    writeLocks(host, held ? [lockLine(1, 500, key(alpha.lockPath))] : []);
    const d = discover(on, on.processTable(), host.places).daemons[0];
    if (d === undefined) throw new Error("no daemon 500");
    return d;
  };

  // Its own registration is 1.2 to 12.1 s after its process start; one before it is not its own.
  test.each([
    ["its own record: serving", work(record(START + 3_000)), "serving"],
    ["its own, within btime's 1 s: serving", work(record(START - 500)), "serving"],
    ["its record cleared, its start kept: stopping", work(null, START + 3_000), "stopping"],
    ["a fresh worktree with no row: starting", work(null, null), "starting"],
    ["a predecessor's cleared record: starting", work(null, START - 60_000), "starting"],
    ["a SIGKILLed predecessor's record: starting", work(record(START - 60_000)), "starting"],
    ["no readable store: unknown", null, "unknown"],
  ] as const)("holding its lock, %s", (_, w, phase) => {
    const d = holder();
    expect(d.holdsLock).toBe(true);
    expect(phaseOn(source)(d, w, NOW)).toBe(phase);
  });

  test("an unreadable boot time is unknown wherever the rule needs the process start", () => {
    const noBoot = Object.assign(withoutLocks(source), {
      locks: () => source.locks(),
      fds: (pid: number) => source.fds(pid),
      fileKey: (path: string) => source.fileKey(path),
      bootTime: () => null,
    });
    const d = holder(noBoot);
    const phase = phaseOn(noBoot);
    expect(phase(d, work(record(START + 3_000)), NOW)).toBe("unknown");
    expect(phase(d, work(null, START + 3_000), NOW)).toBe("unknown");
    expect(phase(d, work(null, null), NOW)).toBe("starting");
  });

  test("without lock state (D10): serving on its own fresh heartbeat, else unknown", () => {
    const bare = withoutLocks(source);
    const d = holder(bare);
    expect(d.holdsLock).toBeNull();
    const phase = phaseOn(bare);
    expect(phase(d, work(record(START + 3_000)), NOW)).toBe("serving");
    // Two intervals of 5 s and a little more.
    expect(phase(d, work(record(START + 3_000, NOW - 10_001)), NOW)).toBe("unknown");
    expect(phase(d, work(null, START + 3_000), NOW)).toBe("unknown");
    expect(phase(d, work(null, null), NOW)).toBe("unknown");
    expect(phase(d, work(record(START - 60_000)), NOW)).toBe("unknown");
    expect(phase(d, null, NOW)).toBe("unknown");
  });

  test("holding no lock is waiting, whatever the row says", () => {
    const d = holder(source, false);
    expect(d.holdsLock).toBe(false);
    expect(phaseOn(source)(d, null, NOW)).toBe("waiting");
    expect(phaseOn(source)(d, work(record(START + 3_000)), NOW)).toBe("waiting");
  });

  test("waiting holds no lock: a request blocked behind the holder is not one", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 510, root: alpha.root, lockPath: alpha.lockPath }),
      daemonProcess({ pid: 511, root: alpha.root, lockPath: alpha.lockPath, awaitLock: true }),
    ]);
    writeLocks(host, [
      lockLine(1, 510, key(alpha.lockPath)),
      lockLine(1, 511, key(alpha.lockPath), true),
      // A lock 511 holds on another file is not its daemon lock.
      lockLine(2, 511, key(beta.lockPath)),
    ]);
    expect(daemonOf(511).holdsLock).toBe(false);
  });

  test("a duplicate root: both found under one id, one holds the lock", () => {
    writeProcesses(host, [
      daemonProcess({ pid: 520, root: alpha.root, lockPath: alpha.lockPath }),
      daemonProcess({ pid: 521, root: alpha.root }),
    ]);
    writeLocks(host, [lockLine(1, 520, key(alpha.lockPath))]);
    const daemons = run().daemons;
    expect(daemons.map((d) => [d.row.pid, d.worktreeId, d.holdsLock])).toEqual([
      [520, alpha.id, true],
      [521, alpha.id, false],
    ]);
  });

  test("a source without fds or locks (D10): the root hash, and phases named unknown", () => {
    writeProcesses(host, [daemonProcess({ pid: 530, root: alpha.root, lockPath: beta.lockPath })]);
    const bare = withoutLocks(source);
    const discovery = discover(bare, bare.processTable(), host.places);
    const [d] = discovery.daemons;
    expect(d).toMatchObject({ worktreeId: alpha.id, holdsLock: null });
    expect(discovery.unknown).toEqual([
      { what: "daemon lock holders", why: expect.stringContaining("heartbeat") },
    ]);
  });
});

describe("socket files (D2 step 4)", () => {
  const sock = (dir: string, id: string): string => {
    const path = join(dir, `squeal-${id}.sock`);
    writeFileSync(path, "");
    return path;
  };
  const listenerLine = (path: string) =>
    `u_str LISTEN 0      511    /run/user/1000/.201327086831dfaa 1057291937            * 0    <-> ino:${statSync(path).ino} dev:0/44 peers:`;

  test("each is tied to the live daemon of its id that holds its lock, and ss confirms it", () => {
    writeProcesses(host, [daemonProcess({ pid: 600, root: alpha.root, lockPath: alpha.lockPath })]);
    writeLocks(host, [lockLine(1, 600, key(alpha.lockPath))]);
    const live = sock(host.places.runtimeDir ?? "", alpha.id);
    const leftover = sock(join(host.places.tempDir, `squeal-${host.places.uid}`), beta.id);
    writeFileSync(join(host.places.runtimeDir ?? "", "squeal-notanid.sock"), "");
    ss = `Netid State Recv-Q Send-Q Local Address:Port Peer Address:PortProcess\n${listenerLine(live)}\n`;
    const sockets = run().sockets;
    expect(sockets.map((s) => [s.path, s.worktreeId, s.daemonPid, s.listening])).toEqual([
      [live, alpha.id, 600, true],
      [leftover, beta.id, null, false],
    ]);
    expect(sockets[1]?.mtimeMs).toBe(statSync(leftover).mtimeMs);
  });

  test("a socket of a daemon that holds no lock is left over; without ss, listening is null", () => {
    writeProcesses(host, [daemonProcess({ pid: 610, root: alpha.root, lockPath: alpha.lockPath })]);
    const path = sock(host.places.runtimeDir ?? "", alpha.id);
    expect(run().sockets).toEqual([
      {
        path,
        worktreeId: alpha.id,
        mtimeMs: statSync(path).mtimeMs,
        daemonPid: null,
        listening: null,
      },
    ]);
  });

  test("a runtime dir that is the temp one is listed once", () => {
    const tempSockets = join(host.places.tempDir, `squeal-${host.places.uid}`);
    sock(tempSockets, alpha.id);
    const places = { ...host.places, runtimeDir: tempSockets };
    expect(discover(source, source.processTable(), places).sockets).toHaveLength(1);
  });
});

describe("the second reading at the window's end (lessons.md P9)", () => {
  /** 540 holds alpha's lock, 541 waits behind it, and 542 holds beta's; each has its socket file. */
  const setUp = () => {
    writeProcesses(host, [
      daemonProcess({ pid: 540, root: alpha.root, lockPath: alpha.lockPath }),
      daemonProcess({ pid: 541, root: alpha.root, lockPath: alpha.lockPath, awaitLock: true }),
      daemonProcess({ pid: 542, root: beta.root, lockPath: beta.lockPath }),
    ]);
    for (const id of [alpha.id, beta.id])
      writeFileSync(join(host.places.runtimeDir ?? "", `squeal-${id}.sock`), "");
  };
  const held = (d: { daemons: readonly FoundDaemon[] }) =>
    d.daemons.map((x) => [x.row.pid, x.holdsLock]);
  const owners = (d: { sockets: readonly { worktreeId: string; daemonPid: number | null }[] }) =>
    d.sockets.map((x) => [x.worktreeId, x.daemonPid]);

  /** Discovery over the fixture's `/proc/locks` as the window's first reading, and that reading. */
  const firstReading = () => {
    const locks = source.locks();
    return { locks, found: discover(source, source.processTable(), host.places, locks) };
  };
  const OTHER = { first: "second", second: "first" } as const;
  const lost = (which: "first" | "second") => ({
    what: "daemon lock holders",
    why: `the window's ${which} /proc/locks reading cannot be read, so a lock the ${OTHER[which]} misses is unknown, not absent: a phase is serving by its heartbeat, or unknown`,
  });

  test("a lock the first reading misses and the second shows is held, and its socket is its daemon's", () => {
    setUp();
    // The first reading lost 540's line between two pages; 541's request still waits.
    writeLocks(host, [
      lockLine(1, 541, key(alpha.lockPath), true),
      lockLine(2, 542, key(beta.lockPath)),
    ]);
    const { locks, found } = firstReading();
    expect(held(found)).toEqual([
      [540, false],
      [541, false],
      [542, true],
    ]);
    writeLocks(host, [
      lockLine(1, 540, key(alpha.lockPath)),
      lockLine(1, 541, key(alpha.lockPath), true),
    ]);
    const both = lockedAgain(source, found, [locks, source.locks()]);
    // 542's lock, missing from the second reading, stays held: either reading is enough.
    expect(held(both)).toEqual([
      [540, true],
      [541, false],
      [542, true],
    ]);
    expect(owners(both).sort()).toEqual(
      [
        [alpha.id, 540],
        [beta.id, 542],
      ].sort(),
    );
    expect(both.unknown).toBe(found.unknown);
  });

  test("a lock two readable readings both miss is not held, and its socket has no daemon", () => {
    setUp();
    writeLocks(host, [lockLine(1, 542, key(beta.lockPath))]);
    const { locks, found } = firstReading();
    const both = lockedAgain(source, found, [locks, source.locks()]);
    expect(held(both)).toEqual([
      [540, false],
      [541, false],
      [542, true],
    ]);
    expect(owners(both).sort()).toEqual(
      [
        [alpha.id, null],
        [beta.id, 542],
      ].sort(),
    );
  });

  test("a second reading that cannot be read leaves a lock the first misses unknown, and names it (reviews/wave-5.md B1)", () => {
    setUp();
    writeLocks(host, [lockLine(1, 542, key(beta.lockPath))]);
    const { locks, found } = firstReading();
    const both = lockedAgain(source, found, [locks, null]);
    expect(held(both)).toEqual([
      [540, null],
      [541, null],
      [542, true],
    ]);
    // Where a lock is unknown, any daemon of its id may hold it (D10's rule): no socket is left over.
    expect(owners(both).sort()).toEqual(
      [
        [alpha.id, 540],
        [beta.id, 542],
      ].sort(),
    );
    expect(both.unknown).toEqual([...found.unknown, lost("second")]);
  });

  test("after a first reading that cannot be read, a lock the second shows is held and one it misses is unknown (reviews/wave-5.md B1)", () => {
    setUp();
    rmSync(join(host.base, "proc", "locks"));
    const { locks, found } = firstReading();
    expect(locks).toBeNull();
    expect(held(found)).toEqual([
      [540, null],
      [541, null],
      [542, null],
    ]);
    writeLocks(host, [lockLine(1, 540, key(alpha.lockPath))]);
    const both = lockedAgain(source, found, [locks, source.locks()]);
    expect(held(both)).toEqual([
      [540, true],
      [541, null],
      [542, null],
    ]);
    // One entry for the lock holders, which names the reading that failed.
    expect(both.unknown.filter((u) => u.what === "daemon lock holders")).toEqual([lost("first")]);
  });

  test("with neither reading, or when every daemon holds its lock, the discovery is the first", () => {
    setUp();
    rmSync(join(host.base, "proc", "locks"));
    const none = firstReading();
    expect(lockedAgain(source, none.found, [null, null])).toBe(none.found);
    rmSync(join(host.base, "proc", "541"), { recursive: true });
    writeLocks(host, [lockLine(1, 540, key(alpha.lockPath)), lockLine(2, 542, key(beta.lockPath))]);
    const all = firstReading();
    expect(lockedAgain(source, all.found, [all.locks, []])).toBe(all.found);
  });
});

test("a daemon process that left between the scan and its arguments is not found", () => {
  const p = daemonProcess({ pid: 700, root: alpha.root });
  writeProcess(host.base, p);
  const table = source.processTable();
  rmSync(join(host.base, "proc", "700"), { recursive: true });
  expect(discover(source, table, host.places).daemons).toEqual([]);
});
