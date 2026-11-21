import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isRecord } from "../fs/json.js";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";
import {
  commandLine,
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
 * Spec 023 D4 step 11, D6 (row 023-36, lessons round 5 T3): the process
 * groups a `--run` request's run started in the working tree. A test may
 * start a process in a session and group of its own with an env of its own
 * (squawk's e2e app and its watcher), which no mark and no daemon group
 * reaches. While the test's worker lives, the new group's leader descends
 * from it: the daemon records the group then (`run-groups-watch.ts`), by
 * its id and its leader's start, and stops it when the run ends. A record
 * outlives a daemon killed mid-run, so `squeal stop` ends what is left.
 * A group is matched by its recorded id only, never by a path or a command
 * line (the human, 2026-11-21).
 */

/** A process group a `--run` run started, by its id and its leader's start. */
export interface RecordedGroup {
  /** The group's id: its leader's pid. */
  readonly pgid: number;
  /** The leader's start, in ticks since boot (`ProcessEntry.start`). */
  readonly start: number;
  /** The run that started it. */
  readonly runId: string;
}

const RECORD_VERSION = 1;

/** The record of the worktree at `root`: `<store dir>/run-groups/<hash of root>.json`. */
export function runGroupsFile(commonDir: AbsolutePath, root: AbsolutePath): AbsolutePath {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(storePaths(commonDir).dir, "run-groups", `${key}.json`);
}

/** The groups in the record at `file`; `[]` when it is missing or not a record. */
export function readGroups(file: AbsolutePath): RecordedGroup[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(value) || value.v !== RECORD_VERSION || !Array.isArray(value.groups)) return [];
  return value.groups.flatMap((group: unknown) => {
    if (!isRecord(group)) return [];
    const { pgid, start, runId } = group;
    if (typeof pgid !== "number" || !Number.isInteger(pgid) || pgid <= 1) return [];
    if (typeof start !== "number" || typeof runId !== "string") return [];
    return [{ pgid, start, runId }];
  });
}

/** Writes `groups` to `file` by rename; removes the file when there are none. */
export function writeGroups(file: AbsolutePath, groups: readonly RecordedGroup[]): void {
  if (groups.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify({ v: RECORD_VERSION, groups })}\n`);
  renameSync(temp, file);
}

/** The daemon's record: kept in memory, written through at each change. */
export class GroupRecord {
  readonly #file: AbsolutePath;
  #groups: RecordedGroup[];

  constructor(file: AbsolutePath) {
    this.#file = file;
    this.#groups = readGroups(file);
  }

  list(): readonly RecordedGroup[] {
    return this.#groups;
  }

  add(group: RecordedGroup): void {
    if (this.#groups.some((known) => same(known, group))) return;
    this.#groups = [...this.#groups, group];
    this.#write();
  }

  remove(groups: readonly RecordedGroup[]): void {
    const kept = this.#groups.filter((known) => !groups.some((group) => same(known, group)));
    if (kept.length === this.#groups.length) return;
    this.#groups = kept;
    this.#write();
  }

  #write(): void {
    try {
      writeGroups(this.#file, this.#groups);
    } catch {
      // A record that cannot be written leaves the stop at the run's end, which reads memory.
    }
  }
}

function same(a: RecordedGroup, b: RecordedGroup): boolean {
  return a.pgid === b.pgid && a.start === b.start;
}

/**
 * The members of `group` among `entries`. While a member lives, the kernel
 * gives no new process the group's id, so a member started at or after the
 * leader is the group's. A live leader whose start differs is another
 * process that took the freed id: such a group is none of the run's, and
 * nothing is returned.
 */
export function membersOf(group: RecordedGroup, entries: readonly ProcessEntry[]): ProcessEntry[] {
  const leader = entries.find(({ pid }) => pid === group.pgid);
  if (leader !== undefined && leader.start !== group.start) return [];
  return entries.filter(({ pgrp, start }) => pgrp === group.pgid && start >= group.start);
}

/** Scans per stop: each after the first finds what a member started while the one before ran. */
const ROUNDS = 3;

/** What `stopGroups` reads and signals; `/proc` on Linux, a table of its own in tests. */
export interface GroupTable extends ProcessTable {
  /** Every process now, the exiting left out. */
  list(): ProcessEntry[];
}

/**
 * Stops every live member of `groups`: SIGTERM, then SIGKILL after the
 * grace (`terminate`), each named with the run that started its group.
 * Linux only; elsewhere nothing is found. Never rejects.
 */
export async function stopGroups(
  groups: readonly RecordedGroup[],
  table: GroupTable | null = PROC_GROUPS,
): Promise<Stopped[]> {
  if (groups.length === 0 || table === null) return [];
  const stopped: Stopped[] = [];
  const seen = new Set<string>();
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const entries = table.list();
      const found = groups.flatMap((group) =>
        membersOf(group, entries)
          .filter((entry) => !seen.has(`${entry.pid}:${entry.start}`))
          .map((entry) => ({ entry, run: `run ${group.runId}` })),
      );
      if (found.length === 0) break;
      for (const { entry } of found) seen.add(`${entry.pid}:${entry.start}`);
      const runOf = new Map(found.map(({ entry, run }) => [entry.pid, run]));
      for (const one of await terminate(
        found.map(({ entry }) => entry),
        table,
      )) {
        const run = runOf.get(one.pid);
        stopped.push(run === undefined ? one : { ...one, run });
      }
      await gone(found.map(({ entry }) => entry));
    }
  } catch {
    // A failed read stops what it stopped so far.
  }
  return stopped;
}

/** What a note says of the processes `stopGroups` stopped. */
export const STOPPED_WHAT = "in a process group a `--run` run started";

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

const PROC_GROUPS: GroupTable | null =
  process.platform === "linux"
    ? {
        list: processes,
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
