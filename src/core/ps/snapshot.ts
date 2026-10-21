import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { storePaths } from "../store/index.js";
import type { AbsolutePath, EpochMs } from "../types/index.js";
import { discover, phaseOn } from "./discover.js";
import { cpuShare, hostTotals, memoryShare, readPool } from "./host.js";
import { measure, sumCosts, takeSample } from "./measure.js";
import type {
  Attribution,
  DaemonWork,
  Discovery,
  Flag,
  FlagFindings,
  FoundDaemon,
  ProcessCost,
  ProcessOwner,
  PsModel,
  PsPlaces,
  TestProcessModel,
} from "./model.js";
import { attribute } from "./processes.js";
import {
  PS_SHAPE_VERSION,
  type PsDaemon,
  type PsHost,
  type PsRepository,
  type PsSnapshot,
  type PsTestProcess,
  type PsUnknown,
  type PsWork,
} from "./shape.js";
import { unknownOf } from "./snapshot-unknown.js";
import { type PsSource, ticksToMs } from "./source.js";
import { readWork } from "./work.js";

/*
 * Spec 014 D1, D4 (task 014-11): one `squeal ps` snapshot. The window opens
 * at the first sample, and every other read runs inside it (D4): discovery,
 * the stores, the marks, the pool and the host. The rest of the window is
 * waited out, and the second sample closes it. That second reading reads
 * Squeal's processes, their stores and their marks again, so the flags that
 * confirm on two samples (D7) have both. The CPU is over the monotonic
 * window; the phases and ages are against the epoch clock read at the
 * first sample. Nothing here writes, signals or connects.
 */

/** The CPU window (D4): about half the error of 1 s. */
export const SAMPLE_MS = 2_000;

export interface SnapshotOptions {
  readonly source: PsSource;
  readonly places: PsPlaces;
  /** D7: `flag` of `flags.ts`. */
  readonly flag: Flag;
  /** `--full`: each descendant, and the counts of the files that never get a flag (D1). */
  readonly full: boolean;
  /** `--repo`: the current repository's daemons, processes, flags and files only (D1). */
  readonly repo: boolean;
  readonly sampleMs: number;
  /** The epoch clock, read once at the first sample. */
  readonly now: () => EpochMs;
  /** Waits out the rest of the window. */
  readonly wait: (ms: number) => Promise<void>;
}

export interface Snapshot {
  readonly shape: PsSnapshot;
  /** Every leftover path, for `--leftovers` (D1). */
  readonly leftovers: readonly AbsolutePath[];
}

/** The flags until the coordinator wires `flag` of `flags.ts` (014-10): none. */
export const noFlags: Flag = () => ({
  daemons: new Map(),
  states: new Map(),
  processes: new Map(),
  orphans: [],
  files: [],
  unflagged: [],
  leftovers: [],
  unknown: [],
});

export async function takeSnapshot(options: SnapshotOptions): Promise<Snapshot> {
  const read = await readWindow(options);
  const findings = options.flag(read.model);
  return { shape: shapeOf(read, findings, options), leftovers: findings.leftovers };
}

/** What the window read, beside the model the flags take. */
interface WindowRead {
  readonly model: PsModel;
  readonly host: PsHost;
  readonly costs: ReadonlyMap<number, ProcessCost>;
  readonly bootTime: EpochMs | null;
  readonly unknown: readonly PsUnknown[];
}

async function readWindow(o: SnapshotOptions): Promise<WindowRead> {
  const { source, places } = o;
  const first = takeSample(source);
  const now = o.now();
  const discovery = discover(source, first.table, places);
  const work = readWork(source, first.table, discovery.daemons);
  const attribution = attribute(source, first.table, ownersOf(discovery.daemons, work.work));
  const pool = readPool(source, places, new Set(discovery.daemons.map((d) => d.row.pid)));
  const reading = source.host();
  const bootTime = source.bootTime();
  await o.wait(Math.max(0, o.sampleMs - (performance.now() - first.atMs)));

  const second = takeSample(source, followed(discovery, work.work, attribution));
  const live = discovery.daemons.filter(
    (d) => second.table.get(d.row.pid)?.startTicks === d.row.startTicks,
  );
  const again = readWork(source, second.table, live);
  const model: PsModel = {
    now,
    places,
    source,
    discovery,
    first: { sample: first, work: work.work, attribution },
    second: {
      sample: second,
      work: again.work,
      attribution: attribute(source, second.table, ownersOf(live, again.work)),
    },
    pool,
  };
  return {
    model,
    // The host files of one read, the busy CPU over the window's two.
    host: hostTotals(
      { ...reading, cpuTime: first.cpuTime },
      { ...reading, cpuTime: second.cpuTime },
    ),
    costs: measure(source, first, second, measured(discovery, attribution)),
    bootTime,
    unknown: [...discovery.unknown, ...work.unknown, ...again.unknown],
  };
}

/**
 * The live daemons, each with the token and tiers of the work read as its
 * own, never a pid key alone (`reviews/wave-1.md` input 2): a starting
 * daemon's work has neither, since its row is a predecessor's.
 */
function ownersOf(
  daemons: readonly FoundDaemon[],
  work: ReadonlyMap<number, DaemonWork>,
): ProcessOwner[] {
  return daemons.map((d) => {
    const own = work.get(d.row.pid);
    return { pid: d.row.pid, token: own?.token ?? null, tiers: own?.tiers ?? [] };
  });
}

/** The daemons, their test processes and those processes' descendants: what the window measures. */
function measured(discovery: Discovery, attribution: Attribution): number[] {
  return [
    ...discovery.daemons.map((d) => d.row.pid),
    ...attribution.processes.flatMap((p) => [p.pid, ...p.descendants]),
  ];
}

/** What the second sample reads: Squeal's processes, the marked ones nobody owns, and the consumers' harnesses. */
function followed(
  discovery: Discovery,
  work: ReadonlyMap<number, DaemonWork>,
  attribution: Attribution,
): number[] {
  const pids = new Set(measured(discovery, attribution));
  for (const u of attribution.unowned) pids.add(u.pid);
  for (const w of work.values())
    for (const c of w.consumers) if (c.harness !== null) pids.add(c.harness.pid);
  return [...pids].sort((a, b) => a - b);
}

function shapeOf(r: WindowRead, findings: FlagFindings, o: SnapshotOptions): PsSnapshot {
  const { model, costs } = r;
  const { first, second } = model;
  const ticks = model.source.clockTicks();
  const startOf = (startTicks: number): EpochMs | null =>
    r.bootTime === null ? null : r.bootTime + ticksToMs(startTicks, ticks);
  const phase = phaseOn(model.source);
  const table = first.sample.table;

  const processOf = (p: TestProcessModel): PsTestProcess => {
    const row = table.get(p.pid);
    const sum = sumCosts(p.descendants.flatMap((pid) => costs.get(pid) ?? []));
    return {
      pid: p.pid,
      lane: p.lane,
      runner: p.runner,
      runId: p.runId,
      files: p.files,
      escaped: p.escaped,
      ...costOf(costs.get(p.pid)),
      // `attribute` takes its processes from this table.
      nice: row?.nice ?? 0,
      startedAt: row === undefined ? null : startOf(row.startTicks),
      descendants: {
        count: p.descendants.length,
        ...sum,
        list: !o.full
          ? null
          : p.descendants.map((pid) => ({
              pid,
              comm: table.get(pid)?.comm ?? "",
              ...costOf(costs.get(pid)),
            })),
      },
      flags: findings.processes.get(p.pid) ?? [],
    };
  };

  const daemonOf = (d: FoundDaemon): PsDaemon => {
    const pid = d.row.pid;
    const work = first.work.get(pid) ?? null;
    const own = phase(d, work, model.now);
    const state = findings.states.get(pid) ?? own;
    return {
      pid,
      phase: own,
      state,
      worktreeId: d.worktreeId,
      root: d.root,
      // A checkout's `dist` names no version; its store row's own record does (D2).
      version: d.version ?? work?.record?.squealVersion ?? null,
      harness: d.harness,
      startedAt: startOf(d.row.startTicks),
      ...costOf(costs.get(pid)),
      permits: model.pool.pool.held === null ? null : (model.pool.permits.get(pid) ?? 0),
      work: workOf(work, model.now, state.startsWith("draining")),
      consumers: (work?.consumers ?? []).map((c) => ({
        harnessPid: c.harness?.pid ?? null,
        alive: c.alive,
        version: c.version,
      })),
      processes: first.attribution.processes.filter((p) => p.daemonPid === pid).map(processOf),
      flags: findings.daemons.get(pid) ?? [],
    };
  };

  const current = model.places.commonDir;
  const blocks = new Map<AbsolutePath | null, PsDaemon[]>();
  for (const d of model.discovery.daemons) {
    const group = blocks.get(d.commonDir) ?? [];
    blocks.set(d.commonDir, [...group, daemonOf(d)]);
  }
  const repositories = [...blocks]
    .map(
      ([commonDir, daemons]): PsRepository => ({
        commonDir,
        current: commonDir !== null && commonDir === current,
        daemons: daemons.sort((a, b) => cpuOf([b]) - cpuOf([a]) || a.pid - b.pid),
      }),
    )
    .filter((repository) => !o.repo || repository.current)
    .sort((a, b) => Number(b.current) - Number(a.current) || cpuOf(b.daemons) - cpuOf(a.daemons));

  const daemons = repositories.flatMap((repository) => repository.daemons);
  const processes = daemons.flatMap((d) => d.processes);
  const below = new Map(first.attribution.processes.map((p) => [p.pid, p.descendants]));
  const pids = [
    ...daemons.map((d) => d.pid),
    ...processes.flatMap((p) => [p.pid, ...(below.get(p.pid) ?? [])]),
  ];
  const total = sumCosts(pids.flatMap((pid) => costs.get(pid) ?? []));
  const ids = o.repo && current !== null ? worktreeIdsOf(current) : null;
  const files =
    ids === null
      ? findings.files
      : findings.files.filter((f) => f.path !== null && ids.has(socketIdOf(f.path)));
  const orphans = o.repo ? [] : findings.orphans;
  const kept = new Set(daemons.flatMap((d) => [d.pid, ...d.processes.map((p) => p.pid)]));
  const shape: Omit<PsSnapshot, "unknown"> = {
    v: PS_SHAPE_VERSION,
    at: model.now,
    sampleMs: second.sample.atMs - first.sample.atMs,
    platform: model.source.platform,
    memory: model.source.memoryKind,
    host: r.host,
    squeal: {
      daemons: daemons.length,
      testProcesses: processes.length,
      cpuPct: total.cpuPct,
      cpuShare: cpuShare(total.cpuPct, first.sample, second.sample, ticks),
      privateBytes: total.privateBytes,
      memoryShare: memoryShare(total.privateBytes, r.host),
      swapBytes: total.swapBytes,
      pool: model.pool.pool,
    },
    repositories,
    orphans,
    files,
    unflaggedFiles: o.full ? findings.unflagged : null,
    flags:
      daemons.reduce((n, d) => n + d.flags.length, 0) +
      processes.reduce((n, p) => n + p.flags.length, 0) +
      orphans.reduce((n, p) => n + p.flags.length, 0) +
      files.length,
  };
  const named = [...r.unknown, ...findings.unknown].filter((u) => !o.repo || ofKept(u.what, kept));
  const covered = new Map(pids.map((pid) => [pid, costs.get(pid) ?? null]));
  return { ...shape, unknown: unknownOf({ shape, named, costs: covered }) };
}

function costOf(cost: ProcessCost | undefined): ProcessCost | Record<keyof ProcessCost, null> {
  return cost ?? { cpuPct: null, cpuMs: null, privateBytes: null, swapBytes: null };
}

function workOf(work: DaemonWork | null, now: EpochMs, draining: boolean): PsWork {
  const departedAt = work?.departedAt ?? null;
  return {
    pending: work?.pending ?? null,
    running: work?.running ?? null,
    tiers: work?.tiers ?? [],
    checkpoints: work?.checkpoints ?? [],
    departedAt,
    // The flags name the drain (D7); its time left is `daemon.idleExitMinutes` after the departure.
    drainLeftMs:
      !draining || work === null || departedAt === null
        ? null
        : Math.max(0, departedAt + work.settings.idleExitMinutes * 60_000 - now),
    lastUsedAt: work?.lastUse?.usedAt ?? null,
  };
}

/** The CPU of daemons and their processes over the sample; what is unknown counts as none. */
function cpuOf(daemons: readonly PsDaemon[]): number {
  let cpu = 0;
  for (const d of daemons) {
    cpu += d.cpuPct ?? 0;
    for (const p of d.processes) cpu += (p.cpuPct ?? 0) + (p.descendants.cpuPct ?? 0);
  }
  return cpu;
}

/** The worktree ids of the repository at `commonDir`: one lock file each (011 C1). */
function worktreeIdsOf(commonDir: AbsolutePath): ReadonlySet<string> {
  try {
    const names = readdirSync(storePaths(commonDir).locksDir);
    return new Set(names.flatMap((n) => /^([0-9a-f]{16})\.sqlite$/.exec(n)?.[1] ?? []));
  } catch {
    // No lock directory: no daemon of this repository ever ran.
    return new Set();
  }
}

function socketIdOf(path: AbsolutePath): string {
  return /^squeal-([0-9a-f]{16})\.sock$/.exec(basename(path))?.[1] ?? "";
}

/** An unknown that names a daemon or process `--repo` dropped is not the current repository's. */
function ofKept(what: string, kept: ReadonlySet<number>): boolean {
  const pid = /^(?:daemon|process) (\d+)\b/.exec(what)?.[1];
  return pid === undefined || kept.has(Number(pid));
}
