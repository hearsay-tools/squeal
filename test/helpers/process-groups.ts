import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/*
 * Row 011-336: a test that removes a folder first waits for the processes
 * that still write there. A process spawned with `detached: true` leads a
 * process group of its own, with what it starts, so these helpers wait for
 * whole groups, as `awaitRunnerHosts` in `test/daemon/helpers.ts` waits for
 * a daemon's runner hosts and what they started.
 */

export interface GroupMember {
  readonly pid: number;
  readonly pgid: number;
  /** The command line. */
  readonly args: string;
}

/** How often a wait looks again. */
const POLL_MS = 50;
/** How long a wait goes on after its SIGKILL. */
const KILLED_MS = 5_000;

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

/** The process groups of the live processes, other than this one, whose command line `matches`. */
export function groupsRunning(matches: (args: string) => boolean): Set<number> {
  const groups = new Set<number>();
  for (const { pid, pgid, args } of processes())
    if (pid !== process.pid && matches(args)) groups.add(pgid);
  return groups;
}

/** The live members of `groups`; asks `ps` only while a signal still reaches one of them. */
export function membersOf(groups: Iterable<number>): GroupMember[] {
  const reached = new Set([...groups].filter((group) => signal(group, 0)));
  if (reached.size === 0) return [];
  return processes().filter(({ pgid }) => reached.has(pgid));
}

/**
 * Waits until no live process is left in `groups`. What is still there after
 * `graceMs` gets SIGKILL, and the wait goes on for at most `KILLED_MS`.
 * Resolves the members it had to kill, empty when every group ended by
 * itself; a caller decides whether that is a failure.
 */
export async function awaitGroups(
  groups: Iterable<number>,
  graceMs: number,
): Promise<GroupMember[]> {
  const waited = [...groups];
  const deadline = Date.now() + graceMs;
  let left = membersOf(waited);
  while (left.length > 0 && Date.now() < deadline) {
    await delay(POLL_MS);
    left = membersOf(waited);
  }
  if (left.length === 0) return [];
  for (const group of new Set(left.map(({ pgid }) => pgid))) signal(group, "SIGKILL");
  const killedBy = Date.now() + KILLED_MS;
  while (membersOf(waited).length > 0 && Date.now() < killedBy) await delay(POLL_MS);
  return left;
}

/** Sends `name` to the group `group`; false when no process of it is there. */
function signal(group: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, name);
    return true;
  } catch {
    return false;
  }
}
