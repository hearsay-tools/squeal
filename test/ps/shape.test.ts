import { expect, test } from "vitest";
import { PS_SHAPE_VERSION, type PsDaemon, type PsSnapshot } from "../../src/core/ps/shape.js";

/*
 * Spec 014 D8 (task 014-04): the keys of `squeal ps --json` `v: 1`. The
 * literal below must type-check as the shape, and every key D8 lists stays
 * in its JSON with `null` kept, never dropped and never read as zero.
 */

const daemon: PsDaemon = {
  pid: 3704612,
  phase: "serving",
  state: "serving",
  worktreeId: "f1ca49e6aa000000",
  root: "/home/user/projects/alpha",
  version: "0.1.235",
  harness: "codex",
  startedAt: 1_792_000_000_000,
  cpuPct: 30,
  cpuMs: 702_000,
  privateBytes: 2_362_232_012,
  swapBytes: 276_824_064,
  permits: 1,
  work: {
    pending: 200,
    running: 12,
    tier: [],
    checkpoint: null,
    departedAt: null,
    drainLeftMs: null,
    lastUsedAt: null,
  },
  consumers: [{ harnessPid: 3212240, alive: true, version: "0.1.235" }],
  processes: [
    {
      pid: 3704700,
      lane: "vitest",
      runner: "vitest",
      runId: null,
      files: null,
      escaped: false,
      cpuPct: 12,
      cpuMs: 29_000,
      privateBytes: 325_058_560,
      swapBytes: null,
      nice: 10,
      startedAt: 1_792_000_100_000,
      descendants: {
        count: 2,
        cpuPct: 1,
        cpuMs: 300,
        privateBytes: 4_096_000,
        swapBytes: 0,
        list: null,
      },
      flags: [],
    },
  ],
  flags: [],
};

const snapshot: PsSnapshot = {
  v: PS_SHAPE_VERSION,
  at: 1_792_000_200_000,
  sampleMs: 2_000,
  platform: "linux",
  memory: "private",
  host: {
    load: [36.8, 41.3, 51.1],
    cpus: 24,
    cpuPressure: 45,
    memoryPressure: { some: 0.64, full: 0.52 },
    memTotal: 50_465_865_728,
    memAvailable: 15_350_000_000,
    swapTotal: 4_294_963_200,
    swapUsed: 4_294_815_744,
    busyCpuPct: 92.4,
  },
  squeal: {
    daemons: 1,
    testProcesses: 1,
    cpuPct: 43,
    cpuShare: 1.9,
    privateBytes: 2_691_386_572,
    memoryShare: 7.7,
    swapBytes: 276_824_064,
    pool: { slots: 23, held: 1 },
  },
  repositories: [{ commonDir: "/home/user/projects/alpha/.git", current: true, daemons: [daemon] }],
  orphans: [],
  files: [
    {
      flag: "stale-socket",
      path: "/run/user/1000/squeal-fd5a859b8ca77ef9.sock",
      count: 1,
      bytes: 0,
      command: "rm /run/user/1000/squeal-fd5a859b8ca77ef9.sock",
    },
  ],
  flags: 1,
  unknown: [
    { what: "daemon 3704612 lastUsedAt", why: "its release does not record its last use (D9)" },
  ],
};

test("the JSON carries every key D8 lists, at every level, with null kept", () => {
  const json = JSON.parse(JSON.stringify(snapshot));
  expect(json).toEqual(snapshot);
  expect(Object.keys(json)).toEqual(
    expect.arrayContaining([
      "v",
      "at",
      "sampleMs",
      "platform",
      "host",
      "squeal",
      "repositories",
      "files",
      "flags",
      "unknown",
    ]),
  );
  expect(Object.keys(json.host)).toEqual(
    expect.arrayContaining([
      "load",
      "cpus",
      "cpuPressure",
      "memoryPressure",
      "memTotal",
      "memAvailable",
      "swapTotal",
      "swapUsed",
      "busyCpuPct",
    ]),
  );
  expect(Object.keys(json.squeal)).toEqual(
    expect.arrayContaining([
      "daemons",
      "testProcesses",
      "cpuPct",
      "cpuShare",
      "privateBytes",
      "memoryShare",
      "swapBytes",
      "pool",
    ]),
  );
  expect(Object.keys(json.squeal.pool)).toEqual(["slots", "held"]);
  expect(Object.keys(json.repositories[0])).toEqual(["commonDir", "current", "daemons"]);
  const d = json.repositories[0].daemons[0];
  expect(Object.keys(d)).toEqual(
    expect.arrayContaining([
      "pid",
      "phase",
      "state",
      "worktreeId",
      "root",
      "version",
      "harness",
      "startedAt",
      "cpuPct",
      "cpuMs",
      "privateBytes",
      "swapBytes",
      "work",
      "consumers",
      "processes",
      "flags",
    ]),
  );
  expect(Object.keys(d.work)).toEqual(
    expect.arrayContaining([
      "pending",
      "running",
      "tier",
      "checkpoint",
      "departedAt",
      "drainLeftMs",
      "lastUsedAt",
    ]),
  );
  expect(d.work.lastUsedAt).toBeNull();
  expect(Object.keys(d.consumers[0])).toEqual(["harnessPid", "alive", "version"]);
  expect(Object.keys(d.processes[0])).toEqual(
    expect.arrayContaining([
      "pid",
      "lane",
      "runner",
      "files",
      "cpuPct",
      "cpuMs",
      "privateBytes",
      "swapBytes",
      "nice",
      "startedAt",
      "descendants",
    ]),
  );
  expect(d.processes[0].swapBytes).toBeNull();
  expect(Object.keys(json.files[0])).toEqual(["flag", "path", "count", "bytes", "command"]);
  expect(json.v).toBe(1);
});
