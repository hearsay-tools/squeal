import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { measure, sumCosts, takeSample } from "../../src/core/ps/measure.js";
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
    });
    expect(reads.get("status") ?? 0).toBe(0);
  });

  test("a process seen in the second sample only has null window CPU and its memory now", () => {
    const { source } = fakeSource([worker]);
    const costs = measure(source, sampleOf(0, []), sampleOf(2_000, [worker]), [worker.pid]);
    expect(costs.get(worker.pid)).toEqual({
      cpuPct: null,
      cpuMs: 2_900,
      privateBytes: 150 * MIB,
      swapBytes: 0,
    });
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
        { cpuPct: 12, cpuMs: 100, privateBytes: 10, swapBytes: null },
        { cpuPct: null, cpuMs: 5, privateBytes: 20, swapBytes: null },
      ]),
    ).toEqual({ cpuPct: 12, cpuMs: 105, privateBytes: 30, swapBytes: null });
    expect(sumCosts([])).toEqual({ cpuPct: 0, cpuMs: 0, privateBytes: 0, swapBytes: 0 });
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
