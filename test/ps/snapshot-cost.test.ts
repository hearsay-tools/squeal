import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import { takeSnapshot } from "../../src/core/ps/snapshot.js";
import { countingSource } from "./fixture-samples.js";
import {
  type CostHost,
  fakeWindow,
  LEFTOVERS,
  type SnapshotHost,
  snapshotHost,
  writeCostHost,
} from "./fixture-snapshot.js";

/*
 * Spec 014 goal 6 and Testing (task 014-11, `reviews/wave-1.md` input 4):
 * the cost of the whole snapshot on a host of 650 processes and 25 daemons,
 * discovery, both store reads, the pool, the host and the flags over 100
 * old leftover directories included. The reads inside the window hide in
 * its 2 s; those after it, and the CPU of all of them, add to the command's
 * cost. The live measure with the load is the dogfood row's (014-15).
 */

let host: SnapshotHost;
let tree: CostHost;

beforeAll(() => {
  host = snapshotHost();
  tree = writeCostHost(host);
}, 120_000);

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

describe("one snapshot on a host of 650 processes and 25 daemons", () => {
  test("the fixture has the host's shape", () => {
    expect(host.source.processTable().size).toBe(650);
    expect(tree.daemons).toHaveLength(25);
  });

  test("the reads inside the window fit in it, those after it take under 0.5 s, and all of them under 0.3 s CPU", async () => {
    const { source, reads } = countingSource(host.source);
    const window = fakeWindow();
    // `performance.now` is the fake window's, so the real time is read apart.
    let opened = 0n;
    let waited = 0n;
    let inside = new Map<string, number>();
    const cpuAtStart = process.cpuUsage();
    opened = process.hrtime.bigint();
    const { shape } = await takeSnapshot({
      source,
      places: host.places,
      flag,
      full: false,
      repo: false,
      sampleMs: 2_000,
      now: window.now,
      wait: async (ms) => {
        waited = process.hrtime.bigint();
        inside = new Map(reads);
        reads.clear();
        await window.wait(ms);
      },
    });
    const closed = process.hrtime.bigint();
    const cpu = process.cpuUsage(cpuAtStart);

    const daemons = shape.repositories.flatMap((r) => r.daemons);
    expect(daemons.map((d) => d.phase)).toEqual(Array(25).fill("serving"));
    expect(shape.squeal).toMatchObject({ daemons: 25, testProcesses: tree.testProcesses });
    expect(daemons.every((d) => d.work.tiers.length === 1 && d.processes.length >= 1)).toBe(true);

    // Inside the window: one scan of the table, the arguments of Node main threads only.
    expect(inside.get("processTable")).toBe(1);
    expect(inside.get("cmdline") ?? 0).toBeLessThan(250);
    // After it: the table and the memory of Squeal's processes only, never the host's 650 again.
    expect(reads.get("processTable")).toBe(tree.squeal.length);
    expect(reads.get("memory")).toBe(tree.squeal.length);
    expect(reads.get("markOf") ?? 0).toBeLessThanOrEqual(tree.squeal.length);
    // The host-wide flags read the first table's processes (`reviews/wave-2.md` B1): one cwd read,
    // and the arguments of each process for the leftovers and of each Node process for the waiters.
    expect(shape.files.find((f) => f.flag === "leftover-temp")?.count).toBe(LEFTOVERS);
    expect(reads.get("cwds")).toBe(1);
    expect(reads.get("cmdline") ?? 0).toBeLessThanOrEqual(2 * 650);

    const insideMs = Number(waited - opened) / 1e6;
    const outsideMs = Number(closed - waited) / 1e6;
    const cpuMs = (cpu.user + cpu.system) / 1000;
    expect(insideMs, `inside the window ${insideMs} ms`).toBeLessThan(2_000);
    expect(outsideMs, `after the window ${outsideMs} ms`).toBeLessThan(500);
    expect(cpuMs, `CPU ${cpuMs} ms`).toBeLessThan(300);
  });
});
