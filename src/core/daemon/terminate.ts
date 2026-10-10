import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/** How long a process told to stop gets before it is killed. */
export const GRACE_MS = 1_000;
/** `/proc` reports start times in USER_HZ, 100 on every Linux architecture Node supports. */
export const TICKS_PER_SECOND = 100;
/** The longest command line a note names. */
const COMMAND_CHARS = 120;

export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  /** Clock ticks since boot. */
  readonly start: number;
}

/** What `terminate` reads and signals; `PROC` on Linux, a table of its own in tests. */
export interface ProcessTable {
  /** The process now at `pid`, or `null` when none is. */
  stat(pid: number): ProcessEntry | null;
  commandLine(pid: number): Promise<string>;
  signal(pid: number, name: NodeJS.Signals): void;
  /** Clock ticks since boot, the clock of `ProcessEntry.start`. */
  uptime(): number;
}

const PROC: ProcessTable = { stat: statOf, commandLine, signal, uptime: uptimeTicks };

/** A process `terminate` stopped, with what a note says of it (task 001-212). */
export interface Stopped {
  readonly pid: number;
  readonly args: string;
  /** Its parent at the scan, before any signal. */
  readonly ppid: number;
  /** The parent's command line, `""` when it could not be read as that parent's. */
  readonly parent: string;
  /** How long it had run when told to stop. */
  readonly ageSeconds: number;
  /** Whether it outlived the grace and got SIGKILL. */
  readonly killed: boolean;
}

/**
 * SIGTERM, up to the grace to go, then SIGKILL. Each signal and the command
 * line a note names reach a process only while the pid still holds the one
 * the scan found, same start time, checked right before (review 001-149 S2):
 * a pid reused in between gets nothing and is not named. Between the check
 * and the signal the pid can still be reused; a pidfd would close that, at
 * the cost of a native call Node does not expose.
 */
export async function terminate(
  found: readonly ProcessEntry[],
  table: ProcessTable = PROC,
): Promise<Stopped[]> {
  const same = (entry: ProcessEntry) => table.stat(entry.pid)?.start === entry.start;
  const named: { entry: ProcessEntry; args: string; ppid: number; parent: string }[] = [];
  for (const entry of found) {
    const now = table.stat(entry.pid);
    if (now?.start !== entry.start) continue;
    const args = await table.commandLine(entry.pid);
    const parent = await table.commandLine(now.ppid);
    // A process keeps its ppid only while that parent lives: an exit reparents
    // it, so the same ppid after the read means the line read was its parent's.
    const after = table.stat(entry.pid);
    const kept = after?.start === entry.start && after.ppid === now.ppid;
    named.push({ entry, args, ppid: now.ppid, parent: kept ? parent : "" });
  }
  // Each identity is checked right before its own signal; one signal may free the next pid (review wave-13b S2).
  const ages = new Map<ProcessEntry, number>();
  for (const { entry } of named) {
    if (!same(entry)) continue;
    ages.set(entry, Math.max(0, table.uptime() - entry.start) / TICKS_PER_SECOND);
    table.signal(entry.pid, "SIGTERM");
  }
  const deadline = Date.now() + GRACE_MS;
  let alive = [...ages.keys()].filter(same);
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(25);
    alive = alive.filter(same);
  }
  const killed = new Set<ProcessEntry>();
  for (const entry of alive) {
    if (!same(entry)) continue;
    table.signal(entry.pid, "SIGKILL");
    killed.add(entry);
  }
  return named.flatMap(({ entry, args, ppid, parent }) => {
    const ageSeconds = ages.get(entry);
    if (ageSeconds === undefined) return [];
    return [{ pid: entry.pid, args, ppid, parent, ageSeconds, killed: killed.has(entry) }];
  });
}

/**
 * One line naming what a stop stopped, or `null` for nothing: per process
 * its pid and command line, its parent's, its age and the signal that ended
 * it (task 001-212).
 */
export function describe(stopped: readonly Stopped[], what: string): string | null {
  if (stopped.length === 0) return null;
  const count = stopped.length === 1 ? "1 process" : `${stopped.length} processes`;
  const list = stopped.map(entryText).join("; ");
  return `stopped ${count} ${what}: ${list}`;
}

function entryText({ pid, args, ppid, parent, ageSeconds, killed }: Stopped): string {
  const ended = killed ? `SIGKILL after ${GRACE_MS / 1_000} s` : "SIGTERM";
  const parentText = `parent ${ppid} ${parent}`.trimEnd();
  return `${`${pid} ${args}`.trimEnd()} (${parentText}, ${ageText(ageSeconds)} old, ${ended})`;
}

/** `4.2 s`, `3 min 5 s`, `2 h 10 min`. */
function ageText(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.floor(seconds);
  if (whole < 3_600) return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  return `${Math.floor(whole / 3_600)} h ${Math.floor((whole % 3_600) / 60)} min`;
}

export function statOf(pid: number): ProcessEntry | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  // The command name is in parentheses and may hold either; the fields follow the last one.
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return null;
  return { pid, ppid: Number(fields[1]), pgrp: Number(fields[2]), start: Number(fields[19]) };
}

async function commandLine(pid: number): Promise<string> {
  try {
    const text = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
    return text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 3)}...` : text;
  } catch {
    return "";
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

export function uptimeTicks(): number {
  if (process.platform !== "linux") return 0;
  try {
    // Synchronous: one small read, at construction and before each tier.
    return Math.floor(
      Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * TICKS_PER_SECOND,
    );
  } catch {
    return 0;
  }
}
