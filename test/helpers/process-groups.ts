import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/*
 * Row 011-336: a test that removes a folder first waits for the processes
 * that still write there. A process spawned with `detached: true` leads a
 * process group and a session of its own, with what it starts, so these
 * helpers wait for whole groups, as `awaitRunnerHosts` in
 * `test/daemon/helpers.ts` waits for a daemon's runner hosts and what they
 * started. Only a group whose leader the caller has identified is waited
 * for or signalled (review 011-336 B1): a process joins a group only inside
 * its own session, so every member of a session leader's group descends
 * from that leader.
 */

export interface GroupMember {
  readonly pid: number;
  readonly pgid: number;
  /** The command line. */
  readonly args: string;
}

/** A process as `/proc` shows it. */
export interface ProcessInfo {
  readonly pid: number;
  readonly pgid: number;
  /** Its session. */
  readonly sid: number;
  /** Its arguments; the first is the name it was started by. */
  readonly argv: readonly string[];
  /** The executable's path. */
  readonly exe: string;
  /** Its environment as it started. */
  readonly env: ReadonlyMap<string, string>;
}

/** How often a wait looks again. */
const POLL_MS = 50;
/** How long a wait goes on after its SIGKILL, unless the caller says. */
const KILLED_MS = 5_000;

/**
 * The live processes, other than this one, that lead a group and a session of
 * their own, as `detached: true` starts them, that `selects` by their
 * arguments and that `owns` once read whole. Read from `/proc` alone: where
 * it is missing (not Linux) or a process cannot be read (another user's), no
 * process is taken.
 */
export function detachedLeaders(
  selects: (argv: readonly string[]) => boolean,
  owns: (process: ProcessInfo) => boolean,
): ProcessInfo[] {
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  const found: ProcessInfo[] = [];
  for (const name of pids) {
    const pid = Number(name);
    if (pid === process.pid) continue;
    const argv = nulSeparated(`/proc/${pid}/cmdline`);
    if (argv === null || !selects(argv)) continue;
    const info = leader(pid, argv);
    if (info !== null && owns(info)) found.push(info);
  }
  return found;
}

/** `pid` read whole when it is alive and leads its group and its session, else null. */
function leader(pid: number, argv: readonly string[]): ProcessInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // After the command's name, which can hold spaces and parentheses: state, ppid, pgrp, session.
    const [state, , pgrp, session] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (state === "Z" || Number(pgrp) !== pid || Number(session) !== pid) return null;
    const environ = nulSeparated(`/proc/${pid}/environ`) ?? [];
    const env = new Map(
      environ.map((entry) => [
        entry.slice(0, entry.indexOf("=")),
        entry.slice(entry.indexOf("=") + 1),
      ]),
    );
    return { pid, pgid: pid, sid: pid, argv, exe: readlinkSync(`/proc/${pid}/exe`), env };
  } catch {
    return null;
  }
}

/** A `/proc` file of NUL-separated strings, or null when it cannot be read. */
function nulSeparated(path: string): string[] | null {
  try {
    const text = readFileSync(path, "utf8");
    return text === "" ? [] : text.replace(/\0$/, "").split("\0");
  } catch {
    return null;
  }
}

/** The processes `ps` lists, zombies left out: a zombie has ended and writes nothing. */
function processes(): GroupMember[] {
  const out = execFileSync(
    "ps",
    ["-A", "-ww", "-o", "pid=", "-o", "pgid=", "-o", "stat=", "-o", "args="],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const found: GroupMember[] = [];
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s?(.*)$/.exec(line);
    if (match === null || match[3]?.startsWith("Z")) continue;
    found.push({ pid: Number(match[1]), pgid: Number(match[2]), args: match[4] ?? "" });
  }
  return found;
}

/** The live members of `groups`; asks `ps` only while a signal still reaches one of them. */
export function membersOf(groups: Iterable<number>): GroupMember[] {
  const reached = new Set([...groups].filter((group) => signalGroup(group, 0)));
  if (reached.size === 0) return [];
  return processes().filter(({ pgid }) => reached.has(pgid));
}

export interface GroupWait {
  /** How long the groups may take to end by themselves before their SIGKILL. */
  readonly graceMs: number;
  /** How long the wait goes on after the SIGKILL; `KILLED_MS` when not given. */
  readonly killedMs?: number;
  /** Sends a signal to a group; tests inject one that cannot reach it. */
  readonly signal?: (group: number, name: NodeJS.Signals) => void;
}

export interface GroupsEnd {
  /** The members still there at the grace's end, which got the SIGKILL. */
  readonly killed: readonly GroupMember[];
  /** The members still alive when the wait gave up after the SIGKILL. */
  readonly alive: readonly GroupMember[];
}

/**
 * Waits until no live process is left in `groups`. What is still there
 * after `graceMs` gets SIGKILL, and the wait goes on for `killedMs`. Says
 * what it had to kill and what was still alive at the end (review 011-336
 * S1): a caller fails on a member still alive and leaves its files in place.
 * `groups` are the caller's own: groups it started, or whose leaders
 * `detachedLeaders` identified.
 */
export async function awaitGroups(groups: Iterable<number>, wait: GroupWait): Promise<GroupsEnd> {
  const { graceMs, killedMs = KILLED_MS, signal = signalGroup } = wait;
  const waited = [...groups];
  const deadline = Date.now() + graceMs;
  let left = membersOf(waited);
  while (left.length > 0 && Date.now() < deadline) {
    await delay(POLL_MS);
    left = membersOf(waited);
  }
  if (left.length === 0) return { killed: [], alive: [] };
  for (const group of new Set(left.map(({ pgid }) => pgid))) signal(group, "SIGKILL");
  const killedBy = Date.now() + killedMs;
  let alive = membersOf(waited);
  while (alive.length > 0 && Date.now() < killedBy) {
    await delay(POLL_MS);
    alive = membersOf(waited);
  }
  return { killed: left, alive };
}

/** "pid command" of each of `members`, for a failure's message. */
export function named(members: readonly GroupMember[]): string {
  return members.map(({ pid, args }) => `${pid} ${args}`).join("; ");
}

/**
 * Processes still alive after their SIGKILL (`GroupsEnd.alive`): they can still write where they
 * ran, so the caller leaves those files in place and fails with them.
 */
export class StillAlive extends Error {
  constructor(
    what: string,
    readonly alive: readonly GroupMember[],
  ) {
    super(`${what} still alive after their SIGKILL: ${named(alive)}`);
    this.name = "StillAlive";
  }
}

/** Sends `name` to the group `group`; false when no process of it is there. */
function signalGroup(group: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, name);
    return true;
  } catch {
    return false;
  }
}
