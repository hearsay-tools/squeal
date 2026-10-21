import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Flag, FlagFindings } from "../../src/core/ps/model.js";
import { PS_SHAPE_VERSION } from "../../src/core/ps/shape.js";
import { noFlags, type SnapshotOptions, takeSnapshot } from "../../src/core/ps/snapshot.js";
import {
  type FakeWindow,
  fakeWindow,
  NOW,
  type SnapshotHost,
  snapshotHost,
} from "./fixture-snapshot.js";

/*
 * Spec 014 D1, D4, D8 (task 014-11): one snapshot runs the stages over one
 * window of two samples and builds the D8 shape. The host is a fixture
 * `/proc` tree with real repositories and stores; the window's clocks are
 * fakes the wait moves, so the window is as long as asked and no test sleeps.
 */

let host: SnapshotHost;
let window: FakeWindow;

beforeEach(() => {
  host = snapshotHost();
  window = fakeWindow();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

function options(overrides: Partial<SnapshotOptions> = {}): SnapshotOptions {
  return {
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
}

describe("a host with no daemon", () => {
  test("the shape has the host, no daemon, no process and no flag; ps starts nothing", async () => {
    const { shape, leftovers } = await takeSnapshot(options());
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
        memTotal: 49_223_972 * 1024,
        memAvailable: 16_890_700 * 1024,
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
    expect(leftovers).toEqual([]);
    // The window is waited out once, whole, since the reads inside it took no time on the fake clock.
    expect(window.waits).toEqual([2_000]);
  });
});
