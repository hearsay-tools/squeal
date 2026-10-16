import { readdirSync, readFileSync } from "node:fs";
import { CHILD_VARIABLE } from "./escaped.js";
import { commandLine, statOf } from "./terminate.js";

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
}

/** A process the daemon started that is still there. */
export interface Leftover {
  readonly pid: number;
  readonly args: string;
}

/** The marks of the daemon `pid`, whose registration's token is `token`. */
export function marksOf(pid: number, token: string | null): DaemonMarks {
  return { pid, token, group: statOf(pid)?.pgrp === pid ? pid : null };
}

/**
 * The processes the daemon of `marks` started that still run: a carrier of
 * its token, or a member of its group, never the daemon itself or `self`.
 * Linux only, through `/proc`; elsewhere none is found. A process another
 * user owns has an environ this one cannot read, and no daemon of this
 * user's starts one.
 */
export async function leftovers(marks: DaemonMarks, self = process.pid): Promise<Leftover[]> {
  if (process.platform !== "linux") return [];
  const needle = marks.token === null ? null : `\0${CHILD_VARIABLE}=${marks.token}`;
  const found: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === self || pid === marks.pid) continue;
    const entry = statOf(pid);
    if (entry === null) continue;
    if ((marks.group !== null && entry.pgrp === marks.group) || carries(pid, needle))
      found.push(pid);
  }
  return Promise.all(found.map(async (pid) => ({ pid, args: await commandLine(pid) })));
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
