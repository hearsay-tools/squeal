import { expect, test } from "vitest";
import { PS_SHAPE_VERSION, type PsDaemon, type PsSnapshot } from "../../src/core/ps/shape.js";

/*
 * Spec 014 D8 with its 2026-10-21 amendments (task 014-04): the keys of
 * `squeal ps --json` `v: 1`. The literal below must type-check as the
 * shape, and the JSON keeps exactly these keys, `null` included: a value
 * that could not be read is never dropped and never reads as zero.
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
    tiers: [
      { runId: "r1", lane: null, files: 200, startedAt: 1_792_000_150_000, checkpointId: null },
    ],
    checkpoints: [{ id: "c1", startedAt: 1_792_000_140_000, lane: "fast", files: 600 }],
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
        count: 1,
        cpuPct: 1,
        cpuMs: 300,
        privateBytes: 4_096_000,
        swapBytes: 0,
        skipped: { cpuPct: 0, privateBytes: 0, swapBytes: 0 },
        list: [
          {
            pid: 3704800,
            comm: "git",
            cpuPct: 1,
            cpuMs: 300,
            privateBytes: 4_096_000,
            swapBytes: 0,
          },
        ],
      },
      flags: [],
    },
  ],
  flags: [{ flag: "hung", reason: "heartbeat 4m old, interval 30s", command: "kill 3704612" }],
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
    skipped: { cpuPct: 1, privateBytes: 0, swapBytes: 1 },
    pool: { slots: 23, held: 1 },
  },
  repositories: [
    {
      commonDir: "/home/user/projects/alpha/.git",
      current: true,
      cpuPct: 43,
      privateBytes: 2_691_386_572,
      swapBytes: 276_824_064,
      skipped: { cpuPct: 1, privateBytes: 0, swapBytes: 1 },
      daemons: [daemon],
    },
  ],
  orphans: [{ pid: 2242955, comm: "chrome", startedAt: null, flags: [] }],
  files: [
    {
      flag: "stale-socket",
      reason:
        "no live daemon of worktree fd5a859b8ca77ef9 holds its lock; changed 2026-10-16 20:36",
      path: "/run/user/1000/squeal-fd5a859b8ca77ef9.sock",
      count: 1,
      bytes: 0,
      command: "rm /run/user/1000/squeal-fd5a859b8ca77ef9.sock",
    },
  ],
  unflaggedFiles: [{ kind: "lock", count: 1560 }],
  flags: 2,
  unknown: [
    { what: "daemon 3704612 lastUsedAt", why: "its release does not record its last use (D9)" },
  ],
};

const keys = (value: object) => Object.keys(value).sort();
const sorted = (list: string) => list.split(" ").sort();

test("the JSON keeps exactly the shipped keys at every level, with null kept", () => {
  const json = JSON.parse(JSON.stringify(snapshot));
  expect(json).toEqual(snapshot);
  expect(json.v).toBe(1);
  expect(keys(json)).toEqual(
    sorted(
      "v at sampleMs platform memory host squeal repositories orphans files unflaggedFiles flags unknown",
    ),
  );
  expect(keys(json.host)).toEqual(
    sorted(
      "load cpus cpuPressure memoryPressure memTotal memAvailable swapTotal swapUsed busyCpuPct",
    ),
  );
  expect(keys(json.squeal)).toEqual(
    sorted("daemons testProcesses cpuPct cpuShare privateBytes memoryShare swapBytes skipped pool"),
  );
  expect(keys(json.squeal.pool)).toEqual(sorted("slots held"));
  expect(keys(json.squeal.skipped)).toEqual(sorted("cpuPct privateBytes swapBytes"));
  expect(keys(json.repositories[0])).toEqual(
    sorted("commonDir current cpuPct privateBytes swapBytes skipped daemons"),
  );
  expect(keys(json.repositories[0].skipped)).toEqual(sorted("cpuPct privateBytes swapBytes"));
  const d = json.repositories[0].daemons[0];
  expect(keys(d)).toEqual(
    sorted(
      "pid phase state worktreeId root version harness startedAt cpuPct cpuMs privateBytes swapBytes permits work consumers processes flags",
    ),
  );
  expect(keys(d.work)).toEqual(
    sorted("pending running tiers checkpoints departedAt drainLeftMs lastUsedAt"),
  );
  expect(d.work.lastUsedAt).toBeNull();
  expect(keys(d.work.tiers[0])).toEqual(sorted("runId lane files startedAt checkpointId"));
  expect(keys(d.work.checkpoints[0])).toEqual(sorted("id startedAt lane files"));
  expect(keys(d.consumers[0])).toEqual(sorted("harnessPid alive version"));
  const p = d.processes[0];
  expect(keys(p)).toEqual(
    sorted(
      "pid lane runner runId files escaped cpuPct cpuMs privateBytes swapBytes nice startedAt descendants flags",
    ),
  );
  expect(p.swapBytes).toBeNull();
  expect(keys(p.descendants)).toEqual(
    sorted("count cpuPct cpuMs privateBytes swapBytes skipped list"),
  );
  expect(keys(p.descendants.skipped)).toEqual(sorted("cpuPct privateBytes swapBytes"));
  expect(keys(p.descendants.list[0])).toEqual(
    sorted("pid comm cpuPct cpuMs privateBytes swapBytes"),
  );
  expect(keys(d.flags[0])).toEqual(sorted("flag reason command"));
  expect(keys(json.orphans[0])).toEqual(sorted("pid comm startedAt flags"));
  expect(keys(json.files[0])).toEqual(sorted("flag reason path count bytes command"));
  expect(keys(json.unknown[0])).toEqual(sorted("what why"));
  expect(keys(json.unflaggedFiles[0])).toEqual(sorted("kind count"));
});

test("without --full the unflagged file counts are null, and the JSON keeps the null", () => {
  const plain: PsSnapshot = { ...snapshot, unflaggedFiles: null };
  const json = JSON.parse(JSON.stringify(plain));
  expect(keys(json)).toContain("unflaggedFiles");
  expect(json.unflaggedFiles).toBeNull();
});

test("four unflagged waiter lock files with no flag: counted, zero flags, no end command", () => {
  const quiet: PsSnapshot = {
    ...snapshot,
    repositories: [],
    orphans: [],
    files: [],
    unflaggedFiles: [{ kind: "waiter-lock", count: 4 }],
    flags: 0,
  };
  const json = JSON.parse(JSON.stringify(quiet));
  expect(json.flags).toBe(0);
  expect(json.files).toEqual([]);
  expect(json.unflaggedFiles).toEqual([{ kind: "waiter-lock", count: 4 }]);
  expect(keys(json.unflaggedFiles[0])).toEqual(sorted("kind count"));
});
