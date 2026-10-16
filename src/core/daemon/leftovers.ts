import { readdirSync, readFileSync } from "node:fs";
import { CHILD_VARIABLE } from "./escaped.js";
import { commandLine, type ProcessEntry, statOf } from "./terminate.js";

/**
 * What marks a daemon's processes for `squeal stop` (D10, D12, task
 * 001-367): the token its test workers carry as `SQUEAL_DAEMON_CHILD`, any
 * lane's, and its process group when it leads one, as a hook's or `squeal
 * start`'s detached spawn makes it. Read while the daemon still runs.
 */
export interface DaemonMarks {
  readonly pid: number;
  readonly token: string | null;
  /** The group the daemon leads, `null` when it leads none. */
  readonly group: number | null;
  /**
   * Members of `group` that are not the daemon's descendants when the marks
   * are read, as `<pid>:<start>`: a process its starter put in the group
   * before it became the daemon (`sh -c '… & exec squeal daemon'`), which it
   * did not start (review 001-429).
   */
  readonly foreign: ReadonlySet<string>;
}

/** A process the daemon started that is still there. */
export interface Leftover {
  readonly pid: number;
  readonly args: string;
}

/** The marks of the daemon `pid`, whose registration's token is `token`. */
export function marksOf(pid: number, token: string | null): DaemonMarks {
  const group = statOf(pid)?.pgrp === pid ? pid : null;
  if (group === null || process.platform !== "linux")
    return { pid, token, group, foreign: new Set() };
  const entries = processes();
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const descends = (entry: ProcessEntry): boolean => {
    for (
      let at: ProcessEntry | undefined = entry, hops = 0;
      at !== undefined && hops < 64;
      hops++
    ) {
      if (at.ppid === pid) return true;
      at = byPid.get(at.ppid);
    }
    return false;
  };
  const foreign = entries.filter(
    (entry) => entry.pgrp === group && entry.pid !== pid && !descends(entry),
  );
  return { pid, token, group, foreign: new Set(foreign.map(identity)) };
}

/** Every process `/proc` lists now that has not begun its exit. */
function processes(): ProcessEntry[] {
  return readdirSync("/proc").flatMap((name) => {
    const entry = /^\d+$/.test(name) ? statOf(Number(name)) : null;
    return entry === null ? [] : [entry];
  });
}

function identity({ pid, start }: ProcessEntry): string {
  return `${pid}:${start}`;
}

/**
 * The processes the daemon of `marks` started that still run: a carrier of
 * its token, or a member of its group outside `foreign`, never the daemon
 * itself or `self`.
 * Linux only, through `/proc`; elsewhere none is found. A process another
 * user owns has an environ this one cannot read, and no daemon of this
 * user's starts one.
 */
export async function leftovers(marks: DaemonMarks, self = process.pid): Promise<Leftover[]> {
  if (process.platform !== "linux") return [];
  const needle = marks.token === null ? null : `\0${CHILD_VARIABLE}=${marks.token}`;
  const entries = processes();
  const byPid = new Map(entries.map((entry) => [entry.pid, entry]));
  const found = entries.filter(
    (entry) =>
      entry.pid !== self &&
      entry.pid !== marks.pid &&
      ((marks.group !== null && entry.pgrp === marks.group) || carries(entry.pid, needle)) &&
      !ofForeign(entry, marks.foreign, byPid),
  );
  const named = await Promise.all(
    found.map(async (entry) => ({ entry, args: await commandLine(entry.pid) })),
  );
  // A pid freed and reused while its command line was read names another process (review 001-429, S1).
  return named.flatMap(({ entry, args }) =>
    statOf(entry.pid)?.start === entry.start ? [{ pid: entry.pid, args }] : [],
  );
}

/** `entry` or one of its ancestors is in `foreign`: what a stranger of the group starts is its own. */
function ofForeign(
  entry: ProcessEntry,
  foreign: ReadonlySet<string>,
  byPid: ReadonlyMap<number, ProcessEntry>,
): boolean {
  for (let at: ProcessEntry | undefined = entry, hops = 0; at !== undefined && hops < 64; hops++) {
    if (foreign.has(identity(at))) return true;
    at = byPid.get(at.ppid);
  }
  return false;
}

/** `pid`'s environ holds `needle`, the bare mark or a lane's. */
function carries(pid: number, needle: string | null): boolean {
  if (needle === null) return false;
  let environ: string;
  try {
    environ = `\0${readFileSync(`/proc/${pid}/environ`, "latin1")}`;
  } catch {
    return false;
  }
  const at = environ.indexOf(needle);
  if (at < 0) return false;
  const next = environ[at + needle.length];
  return next === undefined || next === "\0" || next === ":";
}
