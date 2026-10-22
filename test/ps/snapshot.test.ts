import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { departedMetaKey } from "../../src/core/delivery/expiry.js";
import type { Flag, FlagFindings, PsModel } from "../../src/core/ps/model.js";
import { render } from "../../src/core/ps/render.js";
import {
  PS_SHAPE_VERSION,
  type PsFileFlag,
  type PsFlag,
  type PsFlagName,
} from "../../src/core/ps/shape.js";
import { type SnapshotOptions, takeSnapshot } from "../../src/core/ps/snapshot.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { BOOT_SECONDS, UPTIME_SECONDS } from "./fixture.js";
import { type FakeProcess, fakeSource } from "./fixture-samples.js";
import {
  addTicks,
  fakeWindow,
  forkWorker,
  gitChild,
  NOW,
  noFlags,
  type SnapshotHost,
  STARTED_AT,
  snapshotHost,
  startRun,
  writeCpuTimes,
} from "./fixture-snapshot.js";
import {
  cacheScript,
  daemonProcess,
  daemonRecord,
  type FixtureRepo,
  makeRepo,
  withoutLocks,
  writeProcesses,
  writeStore,
} from "./fixture-stores.js";

/*
 * Spec 014 D1, D4, D8 (task 014-11): one snapshot runs the stages over one
 * window of two samples and builds the D8 shape. The host is a fixture
 * `/proc` tree with real repositories and stores; the window's clocks are
 * fakes the wait moves, so the window is as long as asked and no test
 * sleeps, and the test changes the tree during the wait as a host would.
 */

const TOKEN = daemonRecord({ id: "0", root: "", commonDir: "", lockPath: "", storePath: "" }).token;
let host: SnapshotHost;
let alpha: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

async function snap(during: () => void = () => {}, overrides: Partial<SnapshotOptions> = {}) {
  const window = fakeWindow(during);
  const options: SnapshotOptions = {
    source: host.source,
    places: host.places,
    flag: noFlags,
    full: false,
    repo: false,
    sampleMs: 2_000,
    now: window.now,
    wait: window.wait,
    ...overrides,
  };
  return { shape: await takeSnapshot(options), waits: window.waits };
}

const flagOf = (flag: PsFlagName): PsFlag => ({ flag, reason: `${flag} holds`, command: "kill 1" });
const epochOf = (ageS: number) => (BOOT_SECONDS + UPTIME_SECONDS - ageS) * 1000;
const KIB = 1024;

describe("a host with no daemon", () => {
  test("the shape has the host, no daemon, no process and no flag", async () => {
    const { shape, waits } = await snap();
    expect(shape).toMatchObject({
      v: PS_SHAPE_VERSION,
      at: NOW,
      sampleMs: 2_000,
      platform: "linux",
      memory: "private",
      host: {
        load: [43.21, 36.57, 38.82],
        cpus: 24,
        cpuPressure: 45.57,
        memoryPressure: { some: 0.64, full: 0.52 },
        memTotal: 49_223_972 * KIB,
        memAvailable: 16_890_700 * KIB,
      },
      squeal: {
        daemons: 0,
        testProcesses: 0,
        cpuPct: 0,
        privateBytes: 0,
        swapBytes: 0,
        memoryShare: 0,
        pool: { slots: 23, held: 0 },
      },
      repositories: [],
      orphans: [],
      files: [],
      unflaggedFiles: null,
      flags: 0,
    });
    // The reads inside the window took no time on the fake clock: the whole window is waited out once.
    expect(waits).toEqual([2_000]);
  });
});

describe("a serving daemon with a fork worker", () => {
  test("its row, its test process and its child, each with its CPU over the window, and the totals", async () => {
    writeCpuTimes(host, 1_000_000, 100_000);
    const daemon = host.serve(800, alpha, {
      fill: (store) => startRun(store, alpha, "r1", STARTED_AT + 10_000, 3),
    });
    const worker = forkWorker(801, 800, `${TOKEN}:vitest`);
    const git = gitChild(802, 801);
    writeProcesses(host, [worker, git]);
    const { shape } = await snap(() => {
      addTicks(host, daemon, 100);
      addTicks(host, worker, 200);
      addTicks(host, git, 20);
      writeCpuTimes(host, 1_004_416, 100_384);
    });
    expect(shape.repositories).toHaveLength(1);
    const [repository] = shape.repositories;
    expect(repository).toMatchObject({ commonDir: alpha.commonDir, current: false });
    expect(repository?.daemons[0]).toEqual({
      pid: 800,
      phase: "serving",
      state: "serving",
      worktreeId: alpha.id,
      root: alpha.root,
      version: "0.1.235",
      harness: "claude",
      startedAt: epochOf(600),
      cpuPct: 50,
      cpuMs: 13_000,
      privateBytes: 100_000 * KIB,
      swapBytes: 0,
      permits: 0,
      work: {
        pending: 0,
        running: 0,
        tiers: [
          {
            runId: "r1",
            lane: "fast",
            files: 3,
            startedAt: STARTED_AT + 10_000,
            checkpointId: null,
          },
        ],
        checkpoints: [],
        departedAt: null,
        drainLeftMs: null,
        lastUsedAt: null,
      },
      consumers: [],
      processes: [
        {
          pid: 801,
          lane: "vitest",
          runner: "vitest",
          runId: "r1",
          files: null,
          escaped: false,
          cpuPct: 100,
          cpuMs: 14_000,
          privateBytes: 160_000 * KIB,
          swapBytes: 2_000 * KIB,
          nice: 10,
          startedAt: epochOf(240),
          descendants: {
            count: 1,
            cpuPct: 10,
            cpuMs: 1_200,
            privateBytes: 4_000 * KIB,
            swapBytes: 0,
            skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
            list: null,
          },
          flags: [],
        },
      ],
      flags: [],
    });
    expect(shape.host.busyCpuPct).toBe(92);
    expect(shape.squeal).toMatchObject({
      daemons: 1,
      testProcesses: 1,
      cpuPct: 160,
      privateBytes: (100_000 + 160_000 + 4_000) * KIB,
      swapBytes: 2_000 * KIB,
      skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
    });
    expect(repository).toMatchObject({
      cpuPct: 160,
      privateBytes: (100_000 + 160_000 + 4_000) * KIB,
      swapBytes: 2_000 * KIB,
      skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
    });
    // 4,416 busy ticks in 2 s are 22.08 CPUs; Squeal used 1.6 of them.
    expect(shape.squeal.cpuShare).toBeCloseTo((160 / 2_208) * 100);
    expect(shape.squeal.memoryShare).toBeCloseTo(
      ((264_000 * KIB) / ((49_223_972 - 16_890_700) * KIB)) * 100,
    );
    expect(shape.unknown).toEqual([
      { what: "daemon 800 lastUsedAt", why: expect.stringContaining("D9") },
    ]);
  });

  test("--full lists each descendant and keeps the counts of the files that never get a flag", async () => {
    host.serve(800, alpha);
    writeProcesses(host, [forkWorker(801, 800, `${TOKEN}:vitest`), gitChild(802, 801)]);
    const unflagged = [{ kind: "lock", count: 3 }] as const;
    const flag: Flag = (m) => ({ ...noFlags(m), unflagged });
    const brief = await snap(() => {}, { flag });
    expect(brief.shape.unflaggedFiles).toBeNull();
    expect(brief.shape.repositories[0]?.daemons[0]?.processes[0]?.descendants.list).toBeNull();
    const full = await snap(() => {}, { flag, full: true });
    expect(full.shape.unflaggedFiles).toEqual(unflagged);
    expect(full.shape.repositories[0]?.daemons[0]?.processes[0]?.descendants.list).toEqual([
      { pid: 802, comm: "git", cpuPct: 0, cpuMs: 1_000, privateBytes: 4_000 * KIB, swapBytes: 0 },
    ]);
  });
});

describe("Squeal's CPU counts what ends in the window (task 014-21, lessons.md P2)", () => {
  test("a child that starts and ends between the two samples counts its CPU in its daemon's row and in Squeal's share", async () => {
    writeCpuTimes(host, 1_000_000, 100_000);
    const daemon = host.serve(800, alpha);
    const { shape } = await snap(() => {
      // The daemon used 100 ticks; a child it started and waited for in the window used 150.
      addTicks(host, daemon, 100, 150);
      writeCpuTimes(host, 1_004_416, 100_384);
    });
    expect(shape.repositories[0]?.daemons[0]).toMatchObject({ cpuPct: 125, cpuMs: 13_000 });
    expect(shape.squeal.cpuPct).toBe(125);
    expect(shape.squeal.cpuShare).toBeCloseTo((125 / 2_208) * 100);
    expect(shape.unknown.map((u) => u.what)).not.toContain("squeal cpuPct");
  });

  test("a fork worker that ended in the window counts in its daemon; an escaped process that ended is named as left out", async () => {
    const daemon = host.serve(800, alpha);
    const worker = forkWorker(801, 800, `${TOKEN}:vitest`);
    const escaped = { ...forkWorker(803, 1, `${TOKEN}:slow:vitest`), comm: "chrome" };
    writeProcesses(host, [worker, escaped]);
    const { shape } = await snap(() => {
      // The worker had 1,200 ticks at the first sample and 1,260 at its end, which its daemon waited for.
      rmSync(join(host.base, "proc", "801"), { recursive: true });
      rmSync(join(host.base, "proc", "803"), { recursive: true });
      addTicks(host, daemon, 0, 1_260);
    });
    const d = shape.repositories[0]?.daemons[0];
    expect(d?.cpuPct).toBe(30);
    expect(d?.processes.map((p) => [p.pid, p.cpuPct])).toEqual([
      [801, null],
      [803, null],
    ]);
    expect(shape.squeal.cpuPct).toBe(30);
    expect(shape.unknown).toContainEqual({
      what: "squeal cpuPct",
      why: "a lower bound: it leaves out the CPU in the window of 1 process in one sample only, which no process ps measures waited for: pid 803",
    });
  });

  test("a worker that ended without waiting for its git: no sample shows who waited for the git, so Squeal's, the repository's and the descendants' CPU are lower bounds (reviews/wave-4.md B3)", async () => {
    const daemon = host.serve(800, alpha, { process: { childTicks: 700 } });
    writeProcesses(host, [
      { ...forkWorker(801, 800, `${TOKEN}:vitest`), childTicks: 20 },
      { ...gitChild(803, 801), lifeCpuPct: 20 },
    ]);
    const { shape } = await snap(() => {
      // The worker had 1,220 ticks at the first sample and used 100 more; the daemon waited for it, the init process may have waited for the git.
      rmSync(join(host.base, "proc", "801"), { recursive: true });
      rmSync(join(host.base, "proc", "803"), { recursive: true });
      addTicks(host, daemon, 10, 700 + 1_320);
    });
    const repository = shape.repositories[0];
    // 10 own, and 1,320 less the 1,220 and 40 the two had: exact had the worker waited for the git.
    expect(repository?.daemons[0]?.cpuPct).toBe(35);
    const unsure = { cpuPct: 1, privateBytes: 0, swapBytes: 0 };
    expect(shape.squeal).toMatchObject({ cpuPct: 35, skipped: unsure });
    expect(repository).toMatchObject({ cpuPct: 35, skipped: unsure });
    expect(repository?.daemons[0]?.processes[0]?.descendants).toMatchObject({
      count: 1,
      cpuPct: null,
      skipped: unsure,
    });
    expect(shape.unknown).toContainEqual({
      what: "squeal cpuPct",
      why: "a lower bound: it leaves out the CPU in the window of 1 process that ended after its parent did, or under one whose children's times grew too little, so no sample shows which process waited for it: pid 803",
    });
    const lines = render(shape, { full: false }).split("\n");
    expect(lines.find((l) => l.startsWith("Squeal "))).toMatch(
      /^Squeal {2}CPU at least 0\.\d CPUs/,
    );
    expect(lines.find((l) => l.startsWith(alpha.root))).toMatch(/ · CPU at least 0\.\d · /);
  });

  test("a child born in the window and alive at its end counts all its CPU in its nearest row", async () => {
    const daemon = host.serve(800, alpha);
    const worker = forkWorker(801, 800, `${TOKEN}:vitest`);
    writeProcesses(host, [worker]);
    const { shape } = await snap(() => {
      writeProcesses(host, [{ ...gitChild(805, 801), ageS: 1, lifeCpuPct: 40 }]);
      addTicks(host, daemon, 0);
    });
    const p = shape.repositories[0]?.daemons[0]?.processes[0];
    // The git's 40 ticks in 1 s of life, in 2 s; it is no descendant of the first reading's.
    expect(p).toMatchObject({ pid: 801, cpuPct: 20, descendants: { count: 0 } });
    expect(shape.squeal.cpuPct).toBe(20);
  });
});

describe("memory a descendant left (task 014-24, lessons.md P4)", () => {
  test("a head whose only descendant left by the second sample keeps its own memory: the descendant adds 0, and unknown names it", async () => {
    host.serve(800, alpha);
    const worker = forkWorker(801, 800, `${TOKEN}:vitest`);
    writeProcesses(host, [worker, gitChild(802, 801)]);
    const { shape } = await snap(() => {
      // The worker waited for its git's 100 ticks.
      rmSync(join(host.base, "proc", "802"), { recursive: true });
      addTicks(host, worker, 0, 100);
    });
    const p = shape.repositories[0]?.daemons[0]?.processes[0];
    expect(p).toMatchObject({ pid: 801, privateBytes: 160_000 * KIB, swapBytes: 2_000 * KIB });
    expect(p?.descendants).toMatchObject({
      count: 1,
      cpuPct: 0,
      privateBytes: 0,
      swapBytes: 0,
      skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
    });
    expect(shape.squeal.skipped).toEqual({ cpuPct: 0, privateBytes: 0, swapBytes: 0 });
    expect(shape.unknown).toContainEqual({
      what: "processes privateBytes",
      why: "1 process ended in the window, so it holds none: pid 802",
    });
    expect(shape.unknown.map((u) => u.what)).not.toContain("squeal privateBytes");
  });

  test("the memory is read right after the second stat read, before the stores and the marks are read again", async () => {
    host.serve(800, alpha);
    writeProcesses(host, [forkWorker(801, 800, `${TOKEN}:vitest`)]);
    const calls: string[] = [];
    const source = new Proxy(host.source, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(String(key));
          return value.apply(target, args);
        };
      },
    });
    await snap(() => calls.push("wait"), { source });
    const after = calls.slice(calls.indexOf("wait"));
    const memory = after.lastIndexOf("memory");
    expect(after.indexOf("processTable")).toBeLessThan(after.indexOf("memory"));
    expect(memory).toBeLessThan(after.indexOf("pidNamespace"));
    expect(memory).toBeLessThan(after.indexOf("markOf"));
  });
});

describe("a source without children's times (D10)", () => {
  test("names Squeal's CPU a lower bound, once, and the Squeal and repository lines show it (reviews/wave-4.md S1)", async () => {
    const daemonArgs = ["node", cacheScript("claude", "0.1.235"), "daemon", "/gone/a"];
    const daemon: FakeProcess = { pid: 700, ppid: 1, comm: "node", cmdline: daemonArgs };
    const processes = [
      { ...daemon, childTicks: null },
      { pid: 701, ppid: 700, cmdline: ["node", "x.js"], childTicks: null },
    ];
    const { source } = fakeSource(processes, { readsMarks: false });
    const { shape } = await snap(
      () => {
        // The daemon used 40 ticks; a child that ended in it would add none.
        processes[0] = { ...daemon, childTicks: null, cpuTicks: 40 };
      },
      { source, places: { ...host.places, uid: 1000 } },
    );
    expect(shape.squeal.cpuPct).toBe(20);
    expect(shape.squeal.skipped.cpuPct).toBeGreaterThan(0);
    expect(shape.repositories[0]?.skipped.cpuPct).toBeGreaterThan(0);
    const lines = render(shape, { full: false }).split("\n");
    expect(lines.find((l) => l.startsWith("Squeal "))).toMatch(/^Squeal {2}CPU at least 0\.2 CPUs/);
    expect(lines.find((l) => l.startsWith("repository unknown"))).toMatch(
      / · CPU at least 0\.2 · /,
    );
    expect(shape.unknown.filter((u) => u.what === "squeal cpuPct")).toEqual([
      {
        what: "squeal cpuPct",
        why: "a lower bound: the source reads no children's CPU on this platform (D10), so a process that ends in the window adds none",
      },
    ]);
  });
});

describe("the window (reviews/wave-1.md input 3)", () => {
  test("the flags get both readings, 2 s apart on the monotonic clock, and the epoch clock of the first sample", async () => {
    host.serve(800, alpha);
    // A mark of no live daemon's token, and one that leaves during the window.
    writeProcesses(host, [
      { ...forkWorker(900, 1, "11111111-0000-4000-8000-000000000000:vitest"), comm: "node" },
      { ...forkWorker(901, 1, "11111111-0000-4000-8000-000000000000:vitest"), comm: "node" },
    ]);
    const flag = vi.fn(noFlags);
    const { shape } = await snap(
      () => {
        rmSync(join(host.base, "proc", "901"), { recursive: true });
        writeStore(alpha, daemonRecord(alpha, { heartbeatAt: NOW + 1_000 }));
      },
      { flag },
    );
    const model = flag.mock.calls[0]?.[0] as PsModel;
    expect(model.now).toBe(NOW);
    expect(shape.at).toBe(NOW);
    expect(model.second.sample.atMs - model.first.sample.atMs).toBe(2_000);
    expect(model.first.work.get(800)?.record?.heartbeatAt).toBe(STARTED_AT + 60_000);
    expect(model.second.work.get(800)?.record?.heartbeatAt).toBe(NOW + 1_000);
    expect(model.first.attribution.unowned.map((u) => u.pid)).toEqual([900, 901]);
    expect(model.second.attribution.unowned.map((u) => u.pid)).toEqual([900]);
    // The second sample reads Squeal's processes and the marked ones nobody owns, not the host.
    expect([...model.second.sample.table.keys()].sort()).toEqual([800, 900]);
  });

  test("a wait the reads inside the window shortened, and none once they filled it", async () => {
    host.serve(800, alpha);
    const window = fakeWindow();
    const now = vi.mocked(performance.now);
    let mono = 5_000;
    // Each clock read inside the window moves it 300 ms: the reads took 300 ms.
    now.mockImplementation(() => {
      mono += 300;
      return mono;
    });
    const base = {
      source: host.source,
      places: host.places,
      flag: noFlags,
      full: false,
      repo: false,
    };
    await takeSnapshot({ ...base, sampleMs: 2_000, now: window.now, wait: window.wait });
    expect(window.waits[0]).toBeGreaterThan(0);
    expect(window.waits[0]).toBeLessThan(2_000);
    await takeSnapshot({ ...base, sampleMs: 100, now: window.now, wait: window.wait });
    expect(window.waits[1]).toBe(0);
  });
});

describe("who owns a process (reviews/wave-1.md input 2)", () => {
  test("a starting daemon under a predecessor's row owns none of the predecessor's escaped processes, and no mark is called an orphan", async () => {
    const before = STARTED_AT - 3_600_000;
    host.serve(800, alpha, {
      record: daemonRecord(alpha, { startedAt: before, heartbeatAt: before + 60_000 }),
      fill: (store) => startRun(store, alpha, "theirs", before + 1_000),
    });
    writeProcesses(host, [{ ...forkWorker(900, 1, `${TOKEN}:slow:vitest`), comm: "node" }]);
    const flag = vi.fn(noFlags);
    const { shape } = await snap(() => {}, { flag });
    const [d] = shape.repositories[0]?.daemons ?? [];
    expect(d).toMatchObject({ phase: "starting", processes: [], work: { tiers: [] } });
    const model = flag.mock.calls[0]?.[0] as PsModel;
    expect(model.first.attribution).toEqual({ processes: [], unowned: [] });
    expect(shape.unknown).toContainEqual({
      what: "daemon 800 work",
      why: expect.stringContaining("a predecessor's"),
    });
  });
});

describe("the version (D2)", () => {
  const checkout = "/home/user/src/squeal/dist/cli/index.js";

  test("a checkout's dist takes its store row's version, while the row is its own", async () => {
    host.serve(800, alpha, { process: { cmdline: ["node", checkout, "daemon", alpha.root] } });
    const { shape } = await snap();
    expect(shape.repositories[0]?.daemons[0]).toMatchObject({ version: "0.1.235", harness: null });
  });

  test("a starting daemon has no record, so a checkout's version is unknown and named", async () => {
    const before = STARTED_AT - 3_600_000;
    host.serve(800, alpha, {
      process: { cmdline: ["node", checkout, "daemon", alpha.root] },
      record: daemonRecord(alpha, { startedAt: before, squealVersion: "0.1.200" }),
    });
    const { shape } = await snap();
    expect(shape.repositories[0]?.daemons[0]?.version).toBeNull();
    expect(shape.unknown).toContainEqual({ what: "daemon 800 version", why: expect.any(String) });
  });
});

describe("the phase, with the snapshot's clock (D2, D10)", () => {
  test("without locks, a heartbeat fresh at the snapshot's clock serves, and one old at it is unknown", async () => {
    host.serve(800, alpha);
    const blind = withoutLocks(host.source);
    const fresh = await snap(() => {}, { source: blind });
    expect(fresh.shape.repositories[0]?.daemons[0]?.phase).toBe("serving");
    vi.restoreAllMocks();
    const later = fakeWindow(() => {}, NOW + 60_000);
    const shape = await takeSnapshot({
      source: blind,
      places: host.places,
      flag: noFlags,
      full: false,
      repo: false,
      sampleMs: 2_000,
      now: later.now,
      wait: later.wait,
    });
    expect(shape.repositories[0]?.daemons[0]).toMatchObject({ phase: "unknown", permits: null });
    expect(shape.unknown).toContainEqual({ what: "pool permits", why: expect.any(String) });
  });
});

describe("the flags in the shape (D7, D8)", () => {
  test("each flag on its daemon, process, orphan or file, an information state as the state word with its drain left, and every flag counted", async () => {
    const departed = NOW - 38 * 60_000;
    host.serve(800, alpha, {
      fill: (store) => store.meta.set(departedMetaKey(alpha.id), String(departed)),
    });
    writeProcesses(host, [forkWorker(801, 800, `${TOKEN}:vitest`)]);
    const findings: FlagFindings = {
      daemons: new Map([[800, [flagOf("past-unused")]]]),
      states: new Map([[800, "draining 22m left"]]),
      processes: new Map([[801, [flagOf("overdue-test-process")]]]),
      orphans: [{ pid: 950, comm: "node", startedAt: null, flags: [flagOf("orphan-waiter")] }],
      files: [socketFlag("fd5a859b8ca77ef9"), MARK],
      unflagged: [],
      unknown: [{ what: "flag hung", why: "the lock holders cannot be read" }],
    };
    const { shape } = await snap(() => {}, { flag: () => findings });
    const d = shape.repositories[0]?.daemons[0];
    expect(d).toMatchObject({ phase: "serving", state: "draining 22m left" });
    expect(d?.flags).toEqual([flagOf("past-unused")]);
    expect(d?.work).toMatchObject({ departedAt: departed, drainLeftMs: 22 * 60_000 });
    expect(DEFAULT_POLICY.daemon.idleExitMinutes).toBe(60);
    expect(d?.processes[0]?.flags).toEqual([flagOf("overdue-test-process")]);
    expect(shape.orphans).toEqual(findings.orphans);
    expect(shape.files).toEqual(findings.files);
    expect(shape.flags).toBe(5);
    expect(shape.unknown).toContainEqual(findings.unknown[0]);
  });

  test("without an information state, a departure has no drain left", async () => {
    host.serve(800, alpha, {
      fill: (store) => store.meta.set(departedMetaKey(alpha.id), String(NOW - 60_000)),
    });
    const { shape } = await snap();
    expect(shape.repositories[0]?.daemons[0]?.work).toMatchObject({ drainLeftMs: null });
  });
});

describe("repositories (D1)", () => {
  let beta: FixtureRepo;
  let gamma: FixtureRepo;
  beforeEach(() => {
    beta = makeRepo(host.base, "beta");
    gamma = makeRepo(host.base, "gamma");
  });
  const places = () => ({ ...host.places, commonDir: beta.commonDir });

  async function three() {
    const a = host.serve(800, alpha);
    host.serve(810, beta);
    const g = host.serve(820, gamma);
    return { a, g };
  }

  test("the current repository first, then the others by their CPU over the sample", async () => {
    const { a, g } = await three();
    const { shape } = await snap(
      () => {
        addTicks(host, a, 200);
        addTicks(host, g, 50);
      },
      { places: places() },
    );
    expect(shape.repositories.map((r) => [r.commonDir, r.current])).toEqual([
      [beta.commonDir, true],
      [alpha.commonDir, false],
      [gamma.commonDir, false],
    ]);
  });

  test("--repo keeps the current repository's daemons, processes, flags and socket files only; the host and the pool stay", async () => {
    await three();
    writeProcesses(host, [forkWorker(811, 810, `${TOKEN}:vitest`), forkWorker(801, 800, null)]);
    const findings: FlagFindings = {
      ...noFlags({} as PsModel),
      daemons: new Map([
        [800, [flagOf("older")]],
        [810, [flagOf("past-idle")]],
      ]),
      orphans: [{ pid: 950, comm: "node", startedAt: null, flags: [flagOf("orphan-waiter")] }],
      files: [socketFlag(beta.id), socketFlag(alpha.id), socketFlag("fd5a859b8ca77ef9"), MARK],
      unknown: [
        { what: "daemon 800 settings", why: "x" },
        { what: "daemon 810 settings", why: "y" },
      ],
    };
    const all = await snap(() => {}, { places: places(), flag: () => findings });
    vi.restoreAllMocks();
    const { shape } = await snap(() => {}, { places: places(), flag: () => findings, repo: true });
    expect(shape.repositories.map((r) => r.commonDir)).toEqual([beta.commonDir]);
    expect(shape.orphans).toEqual([]);
    expect(shape.files).toEqual([socketFlag(beta.id)]);
    expect(shape.flags).toBe(2);
    expect(shape.squeal).toMatchObject({
      daemons: 1,
      testProcesses: 1,
      pool: all.shape.squeal.pool,
    });
    expect(shape.host).toEqual(all.shape.host);
    expect(shape.unknown.map((u) => u.what)).toContain("daemon 810 settings");
    expect(shape.unknown.map((u) => u.what)).not.toContain("daemon 800 settings");
    vi.restoreAllMocks();
    const nowhere = await snap(() => {}, { flag: () => findings, repo: true });
    expect([nowhere.shape.repositories, nowhere.shape.files, nowhere.shape.flags]).toEqual([
      [],
      [],
      0,
    ]);
    expect(all.shape.flags).toBe(7);
  });
});

describe("what is unknown (D8): one entry per cause", () => {
  test("a process that left during the window: its window CPU and memory, once each with the count", async () => {
    const daemon = host.serve(800, alpha);
    writeProcesses(host, [
      forkWorker(801, 800, `${TOKEN}:vitest`),
      forkWorker(802, 800, `${TOKEN}:vitest`),
    ]);
    const { shape } = await snap(() => {
      // The daemon waited for both workers' 1,200 ticks each.
      rmSync(join(host.base, "proc", "801"), { recursive: true });
      rmSync(join(host.base, "proc", "802"), { recursive: true });
      addTicks(host, daemon, 0, 2_400);
    });
    const p = shape.repositories[0]?.daemons[0]?.processes[0];
    expect(p).toMatchObject({ cpuPct: null, privateBytes: null, swapBytes: null });
    expect(p?.cpuMs).toBeGreaterThan(0);
    expect(shape.unknown).toEqual(
      expect.arrayContaining([
        {
          what: "processes cpuPct",
          why: "2 processes were in one sample of the window only: pid 801, 802; the ancestor that waited for them counts their CPU",
        },
        {
          what: "processes privateBytes",
          why: "2 processes ended in the window, so they hold none: pid 801, 802",
        },
      ]),
    );
    expect(shape.unknown.filter((u) => u.what.startsWith("process "))).toEqual([]);
  });

  test("a waiting daemon's work is not read, and says why", async () => {
    host.serve(800, alpha);
    writeProcesses(host, [daemonProcess({ pid: 801, root: alpha.root })]);
    const { shape } = await snap();
    const waiting = shape.repositories[0]?.daemons.find((d) => d.pid === 801);
    expect(waiting).toMatchObject({ phase: "waiting", work: { pending: null, running: null } });
    expect(shape.unknown).toContainEqual({
      what: "daemon 801 work",
      why: "it waits for its lock, and its worktree's row is the holder's",
    });
  });

  test("an rss platform reads no swap per process: one entry, however many processes", async () => {
    const memory = { bytes: 300 * KIB * KIB, swapBytes: null };
    const daemonArgs = (root: string) => ["node", cacheScript("claude", "0.1.235"), "daemon", root];
    const { source } = fakeSource(
      [
        { pid: 700, ppid: 1, comm: "node", cmdline: daemonArgs("/gone/a"), memory },
        { pid: 701, ppid: 700, cmdline: ["node", "x.js"], memory },
        { pid: 710, ppid: 1, comm: "node", cmdline: daemonArgs("/gone/b"), memory },
      ],
      { readsMarks: false },
    );
    // The fake rows are uid 1000's.
    const { shape } = await snap(() => {}, { source, places: { ...host.places, uid: 1000 } });
    expect(shape.memory).toBe("rss");
    expect(shape.squeal).toMatchObject({ privateBytes: 900 * KIB * KIB, swapBytes: null });
    const swap = shape.unknown.filter((u) => u.what.includes("swap"));
    expect(swap).toEqual([
      {
        what: "processes swapBytes",
        why: "the source reads no swap per process on this platform (D10)",
      },
    ]);
  });
});

function socketFlag(id: string): PsFileFlag {
  const path = `/run/user/1000/squeal-${id}.sock`;
  return {
    flag: "stale-socket",
    reason: `no live daemon of worktree ${id} holds its lock`,
    path,
    count: 1,
    bytes: 0,
    command: `rm ${path}`,
  };
}

/** A pool mark no repository owns, so `--repo` drops it (D1). */
const MARK: PsFileFlag = {
  flag: "stale-pool-mark",
  reason: "unchanged since 2026-10-21 18:02; readers skip a mark older than 30 s",
  path: "/run/user/1000/squeal/pool.mark.0011223344556677",
  count: 1,
  bytes: 3,
  command: "rm /run/user/1000/squeal/pool.mark.0011223344556677",
};
