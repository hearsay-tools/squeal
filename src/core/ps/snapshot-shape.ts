import { readdirSync } from "node:fs";
import { basename } from "node:path";
import { storePaths } from "../store/index.js";
import type { AbsolutePath, EpochMs } from "../types/index.js";
import { phaseOn } from "./discover.js";
import { cpuShare, memoryShare } from "./host.js";
import { sumCosts } from "./measure.js";
import type {
  DaemonWork,
  FlagFindings,
  FoundDaemon,
  ProcessCost,
  PsModel,
  TestProcessModel,
} from "./model.js";
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
import { ticksToMs } from "./source.js";

/*
 * Spec 014 D1, D8 (task 014-11): the shape of one snapshot, from what its
 * window read and the flags found. The display is the first reading's: its
 * work, its test processes and its phase at the snapshot's clock; the CPU
 * is over the window and the memory is read after it. The current
 * repository comes first, the others by their CPU over the sample; `--repo`
 * keeps the current one's daemons, processes, flags and socket files.
 */

/** What the window read, beside the model the flags take. */
export interface WindowRead {
  readonly model: PsModel;
  readonly host: PsHost;
  readonly costs: ReadonlyMap<number, ProcessCost>;
  readonly bootTime: EpochMs | null;
  readonly unknown: readonly PsUnknown[];
}

/** `--full` and `--repo` (D1). */
export interface ShapeOptions {
  readonly full: boolean;
  readonly repo: boolean;
}

export function shapeOf(r: WindowRead, findings: FlagFindings, o: ShapeOptions): PsSnapshot {
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
    // A lock the first `/proc/locks` reading missed has its store read at the second (`lessons.md` P9).
    const work = first.work.get(pid) ?? second.work.get(pid) ?? null;
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

  // The daemons, their test processes and those processes' descendants: what a total sums.
  const below = new Map(first.attribution.processes.map((p) => [p.pid, p.descendants]));
  const pidsOf = (daemons: readonly PsDaemon[]): number[] => [
    ...daemons.map((d) => d.pid),
    ...daemons.flatMap((d) => d.processes).flatMap((p) => [p.pid, ...(below.get(p.pid) ?? [])]),
  ];
  const totalOf = (daemons: readonly PsDaemon[]) =>
    sumCosts(pidsOf(daemons).flatMap((pid) => costs.get(pid) ?? []));

  const current = model.places.commonDir;
  const blocks = new Map<AbsolutePath | null, PsDaemon[]>();
  for (const d of model.discovery.daemons) {
    const group = blocks.get(d.commonDir) ?? [];
    blocks.set(d.commonDir, [...group, daemonOf(d)]);
  }
  const repositories = [...blocks]
    .map(([commonDir, daemons]): PsRepository => {
      const { cpuPct, privateBytes, swapBytes, skipped } = totalOf(daemons);
      return {
        commonDir,
        current: commonDir !== null && commonDir === current,
        cpuPct,
        privateBytes,
        swapBytes,
        skipped,
        daemons: daemons.sort((a, b) => cpuOf(b) - cpuOf(a) || a.pid - b.pid),
      };
    })
    .filter((repository) => !o.repo || repository.current)
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.cpuPct ?? 0) - (a.cpuPct ?? 0));

  const daemons = repositories.flatMap((repository) => repository.daemons);
  const processes = daemons.flatMap((d) => d.processes);
  const pids = pidsOf(daemons);
  const total = totalOf(daemons);
  const ids = !o.repo ? null : current === null ? new Set<string>() : worktreeIdsOf(current);
  const files =
    ids === null ? findings.files : findings.files.filter((f) => ids.has(socketIdOf(f.path)));
  const orphans = o.repo ? [] : findings.orphans;
  const kept = new Set(daemons.flatMap((d) => [d.pid, ...d.processes.map((p) => p.pid)]));
  const shape: Omit<PsSnapshot, "unknown"> = {
    v: PS_SHAPE_VERSION,
    at: model.now,
    sampleMs: Math.round(second.sample.atMs - first.sample.atMs),
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
      skipped: total.skipped,
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

/** The values of a cost the shape keeps. */
type Cost = Pick<ProcessCost, "cpuPct" | "cpuMs" | "privateBytes" | "swapBytes">;

function costOf(cost: ProcessCost | undefined): Cost | Record<keyof Cost, null> {
  if (cost === undefined) return { cpuPct: null, cpuMs: null, privateBytes: null, swapBytes: null };
  const { cpuPct, cpuMs, privateBytes, swapBytes } = cost;
  return { cpuPct, cpuMs, privateBytes, swapBytes };
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

/** The CPU of a daemon and its processes over the sample; what is unknown counts as none. */
function cpuOf(d: PsDaemon): number {
  let cpu = d.cpuPct ?? 0;
  for (const p of d.processes) cpu += (p.cpuPct ?? 0) + (p.descendants.cpuPct ?? 0);
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
