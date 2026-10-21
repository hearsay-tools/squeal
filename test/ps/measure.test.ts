import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { below, measure, sumCosts, takeSample } from "../../src/core/ps/measure.js";
import type { ProcessOwner } from "../../src/core/ps/model.js";
import { createProcSource } from "../../src/core/ps/proc.js";
import { attribute } from "../../src/core/ps/processes.js";
import type { PsSource } from "../../src/core/ps/source.js";
import { writeHost, writeTree } from "./fixture.js";
import {
  countingSource,
  type FakeProcess,
  fakeSource,
  type HostTree,
  sampleOf,
  writeHostTree,
} from "./fixture-samples.js";

/*
 * Spec 014 D4 (task 014-07): the CPU over the window from two samples
 * matched by pid and start ticks, the cumulative CPU time, the private
 * memory and the swap. The cost bound of the spec's Testing runs over a
 * 650-process fixture tree.
 */

const MIB = 2 ** 20;
const worker = {
  pid: 2353452,
  ppid: 2091490,
  startTicks: 59_999_300,
  cpuTicks: 290,
  memory: { bytes: 150 * MIB, swapBytes: 0 },
} satisfies FakeProcess;

describe("CPU over the window", () => {
  test("two samples of one process, matched by pid and start ticks, give its CPU over the window in percent of one CPU", () => {
    const { source } = fakeSource([{ ...worker, cpuTicks: 490 }]);
    const first = sampleOf(1_000, [worker]);
    // 200 ticks at 100 per second are 2 s of CPU in 2 s: one whole CPU.
    const second = sampleOf(3_000, [{ ...worker, cpuTicks: 490 }]);
    expect(measure(source, first, second, [worker.pid]).get(worker.pid)).toEqual({
      cpuPct: 100,
      cpuMs: 4_900,
      privateBytes: 150 * MIB,
      swapBytes: 0,
      reapedBy: null,
      left: false,
    });
  });

  test("the window is the time between the two samples, and threads' ticks are the process's", () => {
    const { source } = fakeSource([{ ...worker, cpuTicks: 290 + 330 }]);
    const first = sampleOf(10_000, [worker]);
    const second = sampleOf(12_200, [{ ...worker, cpuTicks: 290 + 330 }]);
    // 330 ticks are 3.3 s of CPU in 2.2 s: the daemon's pool threads made it more than one CPU.
    expect(measure(source, first, second, [worker.pid]).get(worker.pid)?.cpuPct).toBeCloseTo(150);
  });

  test("never a lifetime percent: a process that used much CPU before the window and none in it reads 0, its CPU time stays cumulative", () => {
    const busyBefore = { ...worker, startTicks: 100, cpuTicks: 1_500_000 };
    const { source } = fakeSource([busyBefore]);
    const costs = measure(source, sampleOf(0, [busyBefore]), sampleOf(2_000, [busyBefore]), [
      worker.pid,
    ]);
    expect(costs.get(worker.pid)).toMatchObject({ cpuPct: 0, cpuMs: 15_000_000 });
  });

  test("a process seen in the first sample only has null window CPU, never zero, and no memory: it left", () => {
    const { source, reads } = fakeSource([]);
    const costs = measure(source, sampleOf(0, [worker]), sampleOf(2_000, []), [worker.pid]);
    expect(costs.get(worker.pid)).toEqual({
      cpuPct: null,
      cpuMs: 2_900,
      privateBytes: null,
      swapBytes: null,
      reapedBy: null,
      left: true,
    });
    expect(reads.get("status") ?? 0).toBe(0);
  });

  test("a process born in the window, in the second sample only: all its CPU is the window's, and its memory now", () => {
    const born = { ...worker, cpuTicks: 90, childTicks: 10 };
    const { source } = fakeSource([born]);
    const costs = measure(source, sampleOf(0, []), sampleOf(2_000, [born]), [worker.pid]);
    // 90 ticks of its own and 10 of children it waited for, in 2 s.
    expect(costs.get(worker.pid)).toEqual({
      cpuPct: 50,
      cpuMs: 900,
      privateBytes: 150 * MIB,
      swapBytes: 0,
      reapedBy: null,
      left: false,
    });
  });

  test("a zombie at the second sample ended: its CPU counts, it holds no memory, and its status is not read (014-24)", () => {
    const zombie = { ...worker, cpuTicks: 390, state: "Z" };
    const { source, reads } = fakeSource([zombie]);
    const costs = measure(source, sampleOf(0, [worker]), sampleOf(2_000, [zombie]), [worker.pid]);
    expect(costs.get(worker.pid)).toMatchObject({ cpuPct: 50, privateBytes: null, left: true });
    expect(reads.get("status") ?? 0).toBe(0);
  });

  test("a pid that another process took during the window is two processes: the first one's CPU time, no window CPU, not the newcomer's memory", () => {
    const newcomer: FakeProcess = {
      ...worker,
      startTicks: worker.startTicks + 150,
      cpuTicks: 3,
      memory: { bytes: 2 * MIB, swapBytes: 0 },
    };
    const { source, reads } = fakeSource([newcomer]);
    const costs = measure(source, sampleOf(0, [worker]), sampleOf(2_000, [newcomer]), [worker.pid]);
    expect(costs.get(worker.pid)).toEqual({
      cpuPct: null,
      cpuMs: 2_900,
      privateBytes: null,
      swapBytes: null,
      reapedBy: null,
      left: true,
    });
    expect(reads.get("status") ?? 0).toBe(0);
  });

  test("a pid in neither sample has no cost, and a window of no length gives no CPU", () => {
    const { source } = fakeSource([worker]);
    expect(
      measure(source, sampleOf(0, []), sampleOf(2_000, []), [worker.pid]).has(worker.pid),
    ).toBe(false);
    expect(
      measure(source, sampleOf(5, [worker]), sampleOf(5, [worker]), [worker.pid]).get(worker.pid)
        ?.cpuPct,
    ).toBeNull();
  });
});

describe("the CPU of processes that start or end in the window (task 014-21)", () => {
  // A daemon, its fork worker, the worker's git, at 100 ticks per second over a 2 s window.
  const daemon = { pid: 800, ppid: 1, startTicks: 100, cpuTicks: 5_000, childTicks: 700 };
  const fork = { pid: 801, ppid: 800, startTicks: 9_000, cpuTicks: 300, childTicks: 20 };
  const git = { pid: 802, ppid: 801, startTicks: 9_900, cpuTicks: 40, childTicks: 0 };
  const rows = [daemon.pid, fork.pid, git.pid];
  const cpuOf = (first: FakeProcess[], second: FakeProcess[], pids = rows) =>
    measure(fakeSource(second).source, sampleOf(0, first), sampleOf(2_000, second), pids);

  test("a child that starts and ends between the two samples counts in its parent's CPU: its children's times grew by its life", () => {
    // The daemon used 20 ticks itself; a worker it waited for used 150 and was never seen.
    const costs = cpuOf([daemon], [{ ...daemon, cpuTicks: 5_020, childTicks: 850 }], [daemon.pid]);
    expect(costs.get(daemon.pid)).toMatchObject({ cpuPct: 85, cpuMs: 50_200, reapedBy: null });
  });

  test("a row that ended in the window: its CPU in it counts in the ancestor that waited for it, not its life before it", () => {
    // The worker had 320 ticks with its children's at the first sample and 420 at its end.
    const later = { ...daemon, cpuTicks: 5_010, childTicks: 700 + 420 + 50 };
    const costs = cpuOf([daemon, fork, git], [later]);
    // The git, ended too, had 40; the worker waited for it, so its 50 ticks at the end are in the 420.
    expect(costs.get(fork.pid)).toMatchObject({ cpuPct: null, reapedBy: daemon.pid });
    expect(costs.get(git.pid)).toMatchObject({ cpuPct: null, reapedBy: daemon.pid });
    // 10 own, and 470 the children grew less the 320 and 40 they had: 120 ticks in 2 s.
    expect(costs.get(daemon.pid)?.cpuPct).toBe(60);
  });

  test("a child born in the window counts all its ticks in its nearest row, here a row that lived through it", () => {
    const born = { pid: 803, ppid: 801, startTicks: 10_050, cpuTicks: 30, childTicks: 6 };
    const costs = cpuOf([daemon, fork], [daemon, { ...fork, cpuTicks: 340 }, born]);
    // The worker's own 40 and the git it started, 36 with what that git waited for.
    expect(costs.get(fork.pid)?.cpuPct).toBe(38);
    expect(costs.get(daemon.pid)?.cpuPct).toBe(0);
    expect(costs.has(born.pid)).toBe(false);
  });

  test("a process below a row that is no row, a daemon's own git, adds its growth to the daemon's row", () => {
    const own = { pid: 810, ppid: 800, startTicks: 9_990, cpuTicks: 4, childTicks: 0 };
    const costs = cpuOf([daemon, own], [daemon, { ...own, cpuTicks: 24 }], [daemon.pid]);
    expect(costs.get(daemon.pid)?.cpuPct).toBe(10);
  });

  test("a process that ended and no measured process waited for, an escaped browser, comes off no row and is named by reapedBy", () => {
    const browser = { pid: 900, ppid: 1, startTicks: 9_500, cpuTicks: 800, childTicks: 0 };
    const costs = cpuOf([daemon, browser], [daemon], [daemon.pid, browser.pid]);
    expect(costs.get(browser.pid)).toMatchObject({ cpuPct: null, reapedBy: null });
    expect(costs.get(daemon.pid)?.cpuPct).toBe(0);
  });

  test("a source without children's times (D10): a child that ended is left out, never taken off its parent", () => {
    const blind = (p: FakeProcess) => ({ ...p, childTicks: null });
    const costs = cpuOf(
      [blind(daemon), blind(fork)],
      [blind({ ...daemon, cpuTicks: 5_040 })],
      [daemon.pid, fork.pid],
    );
    expect(costs.get(fork.pid)).toMatchObject({ cpuPct: null, reapedBy: null });
    expect(costs.get(daemon.pid)?.cpuPct).toBe(20);
  });

  test("children waited for outside the tree add nothing, never less: a row's CPU is at least its own", () => {
    // The worker's git was left to the init process when the worker ended first: 40 ticks come off, none came in.
    const costs = cpuOf(
      [daemon, fork, git],
      [{ ...daemon, cpuTicks: 5_010, childTicks: 700 + 320 }],
    );
    expect(costs.get(daemon.pid)?.cpuPct).toBe(5);
  });

  test("below gives the pids and every process under them, once each", () => {
    const table = sampleOf(0, [daemon, fork, git, { pid: 5, ppid: 1 }]).table;
    expect(below(table, [daemon.pid, fork.pid]).sort()).toEqual([800, 801, 802]);
  });
});

describe("memory", () => {
  let root: string;
  let source: PsSource;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "squeal-ps-measure-"));
    writeTree(root);
    source = createProcSource({ root, availableParallelism: () => 24 });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("private memory is RssAnon + RssShmem and swap is VmSwap, from status; never RSS", () => {
    const first = takeSample(source);
    const second = takeSample(source);
    const costs = measure(source, first, second, [2091490, 2242955]);
    // 665,208 + 512 kB, with 2,048 kB swapped; Chrome's 81,000 + 26,000 kB, RSS 56,868 kB more.
    expect(costs.get(2091490)).toMatchObject({
      privateBytes: 665_720 * 1024,
      swapBytes: 2_048 * 1024,
    });
    expect(costs.get(2242955)).toMatchObject({ privateBytes: 107_000 * 1024, swapBytes: 0 });
  });

  test("null where the source cannot read: a kernel thread has no memory, a macOS source no swap", () => {
    expect(measure(source, takeSample(source), takeSample(source), [2]).get(2)).toMatchObject({
      privateBytes: null,
      swapBytes: null,
    });
    const darwin = fakeSource([{ ...worker, memory: { bytes: 300 * MIB, swapBytes: null } }], {
      readsMarks: false,
    });
    const costs = measure(darwin.source, sampleOf(0, [worker]), sampleOf(2_000, [worker]), [
      worker.pid,
    ]);
    expect(costs.get(worker.pid)).toMatchObject({ privateBytes: 300 * MIB, swapBytes: null });
  });
});

describe("takeSample", () => {
  test("one table read of every process, or of the pids asked, with the host's CPU times and a monotonic time", () => {
    const { source, reads } = fakeSource([worker, { pid: 1, ppid: 0 }]);
    const first = takeSample(source);
    expect([...first.table.keys()].sort()).toEqual([1, worker.pid]);
    expect(first.cpuTime).toEqual({ busy: 1_000_000, total: 1_100_000 });
    const second = takeSample(source, [worker.pid]);
    expect([...second.table.keys()]).toEqual([worker.pid]);
    expect(second.atMs).toBeGreaterThanOrEqual(first.atMs);
    expect(reads.get("stat")).toBe(3);
  });
});

describe("sumCosts", () => {
  test("sums each value over the processes that have one; null only when none has", () => {
    expect(
      sumCosts([
        { cpuPct: 12, cpuMs: 100, privateBytes: 10, swapBytes: null, reapedBy: null, left: false },
        { cpuPct: null, cpuMs: 5, privateBytes: 20, swapBytes: null, reapedBy: null, left: false },
      ]),
    ).toEqual({
      cpuPct: 12,
      cpuMs: 105,
      privateBytes: 30,
      swapBytes: null,
      skipped: { cpuPct: 1, privateBytes: 0, swapBytes: 2 },
    });
    expect(sumCosts([])).toEqual({
      cpuPct: 0,
      cpuMs: 0,
      privateBytes: 0,
      swapBytes: 0,
      skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
    });
  });

  // A live process, a worker that ended under its daemon, and an escaped browser that ended under no measured process.
  const live = {
    cpuPct: 10,
    cpuMs: 1,
    privateBytes: 100,
    swapBytes: 0,
    reapedBy: null,
    left: false,
  };
  const reaped = {
    ...live,
    cpuPct: null,
    privateBytes: null,
    swapBytes: null,
    reapedBy: 800,
    left: true,
  };
  const lost = { ...reaped, reapedBy: null };

  test("one that ended adds no memory and its reaper holds its CPU: only a CPU no row holds is left out (014-24)", () => {
    expect(sumCosts([live, reaped, lost])).toEqual({
      cpuPct: 10,
      cpuMs: 3,
      privateBytes: 100,
      swapBytes: 0,
      skipped: { cpuPct: 1, privateBytes: 0, swapBytes: 0 },
    });
  });

  test("a head's only descendant gone at the second sample: its sums are 0, never unknown", () => {
    expect(sumCosts([reaped])).toEqual({
      cpuPct: 0,
      cpuMs: 1,
      privateBytes: 0,
      swapBytes: 0,
      skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
    });
  });

  test("a sum that leaves out every value it has is unknown, with what it left out", () => {
    const unread = { ...live, cpuPct: null, privateBytes: null, swapBytes: null };
    expect(sumCosts([unread, reaped])).toMatchObject({
      cpuPct: null,
      privateBytes: null,
      skipped: { cpuPct: 1, privateBytes: 1, swapBytes: 1 },
    });
  });

  test("a test process's descendants are summed into it: the fixture fork worker's git", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-ps-sum-"));
    try {
      writeTree(root);
      const source = createProcSource({ root });
      const first = takeSample(source);
      const attribution = attribute(source, first.table, [
        { pid: 2091490, token: "6500d1d2-7ae8-4039-a08e-1b231205f5c8", tiers: [] },
      ]);
      const worker = attribution.processes.find((p) => p.pid === 2353452);
      expect(worker?.descendants).toEqual([2353500]);
      const costs = measure(source, first, takeSample(source), worker?.descendants ?? []);
      expect(sumCosts([...costs.values()])).toMatchObject({
        privateBytes: 4_000 * 1024,
        swapBytes: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cost on a host of 650 processes (spec 014 Testing, goal 6)", () => {
  let root: string;
  let tree: HostTree;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "squeal-ps-cost-"));
    writeHost(root);
    tree = writeHostTree(root);
  }, 60_000);
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("the fixture has the host's shape", () => {
    const table = createProcSource({ root }).processTable();
    expect(table.size).toBe(650);
    expect(tree.daemons).toHaveLength(25);
  });

  test("the reads outside the window read only Squeal's processes, under 0.5 s wall, and every stage stays under 0.3 s CPU", () => {
    const { source, reads } = countingSource(
      createProcSource({ root, availableParallelism: () => 24 }),
    );
    const owners: ProcessOwner[] = tree.daemons.map((pid) => ({
      pid,
      token: tree.tokens.get(pid) ?? null,
      tiers: [],
    }));
    const cpuAtStart = process.cpuUsage();

    // Inside the window: the first sample and the per-process reads.
    const first = takeSample(source);
    const attribution = attribute(source, first.table, owners);
    const inside = new Map(reads);
    reads.clear();

    // After the window: the second sample of Squeal's pids, and their memory.
    const wallAtEnd = performance.now();
    const second = takeSample(source, tree.squeal);
    const costs = measure(source, first, second, tree.squeal);
    const outsideMs = performance.now() - wallAtEnd;
    const cpu = process.cpuUsage(cpuAtStart);

    expect(attribution.processes).toHaveLength(tree.testProcesses);
    expect(costs.size).toBe(tree.squeal.length);
    expect(inside.get("processTable")).toBe(1);
    expect(inside.get("cmdline")).toBe(tree.testProcesses);
    expect(inside.get("markOf") ?? 0).toBeLessThanOrEqual(650);
    expect(Object.fromEntries(reads)).toEqual({
      processTable: tree.squeal.length,
      host: 1,
      clockTicks: 1,
      memory: tree.squeal.length,
    });
    expect(outsideMs).toBeLessThan(500);
    expect((cpu.user + cpu.system) / 1000).toBeLessThan(300);
  });
});
