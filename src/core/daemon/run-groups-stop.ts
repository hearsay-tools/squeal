import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { DaemonNote } from "../types/scheduler.js";
import { type RecordedRun, RUN_GROUP_VARIABLE, type SeenGroup } from "./run-groups.js";
import {
  childrenOf,
  commandLine,
  describe,
  exited,
  GRACE_MS,
  type ProcessEntry,
  type ProcessTable,
  type Stopped,
  statOf,
  terminate,
  uptimeTicks,
} from "./terminate.js";

/*
 * Row 023-36 (spec 023 D4 step 11, D6; T3, review wave-20 B6, B7): which
 * processes a `--run` run's stop reaches. Proven the run's, and stopped:
 * a process whose env carries the run's token (`RUN_GROUP_VARIABLE`),
 * which nothing but the run's processes can hold; and a member of a group
 * whose leader is alive and carries the token, since the kernel gives no
 * other process the group's id while its leader lives. Never the run's own
 * workers, the daemon's children or its runner host's, which carry the
 * token while the run lasts. Spared and named: a member of a group a
 * marked process led that carries no token once that leader is gone,
 * since a group id alone proves nothing after its leader exits (B6). A
 * process with no token or another run's token is never signalled.
 */

/** What a stop reads and signals; `/proc` on Linux, a table of its own in tests. */
export interface RunTable extends ProcessTable {
  /** Every process now, the exiting left out. */
  list(): ProcessEntry[];
  /** `RUN_GROUP_VARIABLE`'s value in the env of `pid`; `null` for none or unreadable. */
  token(pid: number): string | null;
}

/** A process the stop left running, though it is in a group a marked process of the run led. */
export interface Spared {
  readonly pid: number;
  readonly pgid: number;
  readonly runId: string;
}

export interface RunStop {
  readonly stopped: readonly Stopped[];
  readonly spared: readonly Spared[];
  /** The groups marked processes of each run led, by token, for the record (`RunRecord.saw`). */
  readonly groups: ReadonlyMap<string, readonly SeenGroup[]>;
}

/** Spares the runs' own workers (`workersOf`); none by default. */
export type WorkerRule = (entry: ProcessEntry, table: RunTable) => boolean;

/** Scans per stop: each after the first finds what a process started while the one before ran. */
const ROUNDS = 3;

/**
 * Stops what `runs` started (see the module comment), each named with its
 * run; `worker` spares the runs' own workers. Linux only; elsewhere nothing
 * is found. Never rejects.
 */
export async function stopRuns(
  runs: readonly RecordedRun[],
  worker: WorkerRule = () => false,
  table: RunTable | null = PROC_RUNS,
): Promise<RunStop> {
  const groups = new Map<string, SeenGroup[]>();
  if (runs.length === 0 || table === null) return { stopped: [], spared: [], groups };
  const byToken = new Map(runs.map((run) => [run.token, run]));
  const stopped: Stopped[] = [];
  let spared: Spared[] = [];
  const seen = new Set<string>();
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const look = targets(byToken, table.list(), table, worker);
      for (const [token, led] of look.groups) groups.set(token, merged(groups.get(token), led));
      if (round === 0) spared = look.spared;
      const found = look.found.filter(({ entry }) => !seen.has(`${entry.pid}:${entry.start}`));
      if (found.length === 0) break;
      for (const { entry } of found) seen.add(`${entry.pid}:${entry.start}`);
      const runOf = new Map(found.map(({ entry, runId }) => [entry.pid, runId]));
      const entries = found.map(({ entry }) => entry);
      for (const one of await terminate(entries, table)) {
        const runId = runOf.get(one.pid);
        stopped.push(runId === undefined ? one : { ...one, run: `run ${runId}` });
      }
      await gone(entries);
    }
  } catch {
    // A failed read stops what it stopped so far.
  }
  const left = spared.filter(({ pid }) => !stopped.some((one) => one.pid === pid));
  return { stopped, spared: left, groups };
}

function merged(known: readonly SeenGroup[] = [], more: readonly SeenGroup[]): SeenGroup[] {
  const fresh = more.filter((g) => !known.some((k) => k.pgid === g.pgid && k.start === g.start));
  return [...known, ...fresh];
}

interface Look {
  readonly found: { entry: ProcessEntry; runId: string }[];
  readonly spared: Spared[];
  readonly groups: Map<string, SeenGroup[]>;
}

function targets(
  byToken: ReadonlyMap<string, RecordedRun>,
  entries: readonly ProcessEntry[],
  table: RunTable,
  worker: WorkerRule,
): Look {
  const self = process.pid;
  const others = entries.filter(({ pid }) => pid !== self);
  const runOf = new Map<number, RecordedRun>();
  for (const entry of others) {
    const token = table.token(entry.pid);
    const run = token === null ? undefined : byToken.get(token);
    if (run !== undefined && !worker(entry, table)) runOf.set(entry.pid, run);
  }
  // Leaders alive and carrying a run's token: their whole group is proven the run's.
  const leaders = new Map<number, RecordedRun>();
  const groups = new Map<string, SeenGroup[]>();
  for (const entry of others) {
    const run = runOf.get(entry.pid);
    if (run === undefined || entry.pgrp !== entry.pid) continue;
    leaders.set(entry.pid, run);
    const led = { pgid: entry.pid, start: entry.start };
    groups.set(run.token, [...(groups.get(run.token) ?? []), led]);
  }
  const found: Look["found"] = [];
  const spared: Spared[] = [];
  for (const entry of others) {
    const run = runOf.get(entry.pid) ?? leaders.get(entry.pgrp);
    if (run !== undefined) {
      if (!worker(entry, table)) found.push({ entry, runId: run.runId });
      continue;
    }
    const of = sparedBy(byToken, entry);
    if (of !== null) spared.push({ pid: entry.pid, pgid: entry.pgrp, runId: of.runId });
  }
  return { found, spared, groups };
}

/** The run whose recorded group `entry` is in, born after its leader; `null` for none. */
function sparedBy(
  byToken: ReadonlyMap<string, RecordedRun>,
  entry: ProcessEntry,
): RecordedRun | null {
  for (const run of byToken.values())
    for (const group of run.groups)
      if (group.pgid === entry.pgrp && entry.start >= group.start) return run;
  return null;
}

/**
 * The daemon's spare rule: a run's worker is a process the daemon, or a
 * process of its tree without the same token, started: a runner host's
 * fork or a node:test file's process. What a worker starts carries the
 * token from its parent and is no worker.
 */
export function workersOf(self: number = process.pid): WorkerRule {
  const tree = new Set<number>([self]);
  for (const queue = [self]; queue.length > 0; ) {
    const pid = queue.pop() as number;
    for (const child of childrenOf(pid))
      if (!tree.has(child)) {
        tree.add(child);
        queue.push(child);
      }
  }
  return (entry, table) => {
    if (!tree.has(entry.ppid)) return false;
    return entry.ppid === self || table.token(entry.ppid) !== table.token(entry.pid);
  };
}

/** What a note says of the processes a run's stop stopped. */
export const STOPPED_WHAT = "a `--run` run started";

/** Where the mark cannot reach, said when the stop spares a process. */
export const NOT_COVERED =
  "Squeal marks what a test starts through Node while its recorder runs; it cannot mark what a program that clears its env starts, pytest tests, or runs without the recorder";

/** The note of a run's stop: what it stopped, and what it spared and why; `null` for neither. */
export function runStopNote(
  stop: Pick<RunStop, "stopped" | "spared">,
): Required<Pick<DaemonNote, "text" | "stopped">> | null {
  const note = describe(stop.stopped, STOPPED_WHAT);
  const spared = sparedText(stop.spared);
  if (spared === null) return note;
  if (note === null) return { text: spared, stopped: { what: STOPPED_WHAT, commands: [] } };
  return { ...note, text: `${note.text}; ${spared}` };
}

/** The clause naming what a stop spared, or `null` for nothing. */
export function sparedText(spared: readonly Spared[]): string | null {
  if (spared.length === 0) return null;
  const count = spared.length === 1 ? "1 process" : `${spared.length} processes`;
  const list = spared
    .map(({ pid, pgid, runId }) => `${pid} (group ${pgid}, run ${runId})`)
    .join("; ");
  return `left ${count} running in a group a \`--run\` run's process led: ${list}; the leader is gone and no mark of the run is on it, so Squeal cannot prove it is the run's (${NOT_COVERED})`;
}

async function gone(entries: readonly ProcessEntry[]): Promise<void> {
  const deadline = Date.now() + GRACE_MS;
  let left = entries.filter((entry) => !exited(entry));
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(25);
    left = left.filter((entry) => !exited(entry));
  }
}

function processes(): ProcessEntry[] {
  return readdirSync("/proc").flatMap((name) => {
    const entry = /^\d+$/.test(name) ? statOf(Number(name)) : null;
    return entry === null ? [] : [entry];
  });
}

/** `RUN_GROUP_VARIABLE`'s value in `pid`'s environ; `null` for none, gone, or another user's. */
function tokenOf(pid: number): string | null {
  let environ: string;
  try {
    environ = `\0${readFileSync(`/proc/${pid}/environ`, "latin1")}`;
  } catch {
    return null;
  }
  const needle = `\0${RUN_GROUP_VARIABLE}=`;
  const at = environ.indexOf(needle);
  if (at < 0) return null;
  const end = environ.indexOf("\0", at + needle.length);
  return environ.slice(at + needle.length, end < 0 ? undefined : end);
}

const PROC_RUNS: RunTable | null =
  process.platform === "linux"
    ? {
        list: processes,
        token: tokenOf,
        stat: statOf,
        commandLine,
        signal(pid, name) {
          try {
            process.kill(pid, name);
          } catch {
            // Already gone.
          }
        },
        uptime: uptimeTicks,
      }
    : null;
