// The processes of a fake evals root (fake-cell.ts), named by ownership and start time, so its
// teardown signals nothing it does not own (014-32, review B3).
import { readdirSync, readFileSync } from "node:fs";

/**
 * A process's start time in clock ticks since boot (`/proc/<pid>/stat`, field 22), which names it
 * apart from a later process given the same pid; `null` once it has ended or waits as a zombie,
 * and where `/proc` cannot be read.
 */
export function startOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" || fields[0] === "X" ? null : (fields[19] ?? null);
  } catch {
    return null;
  }
}

/** A process a fake root owns, as `cellProcesses` read it. */
export interface CellProcess {
  pid: number;
  /** Its start time (`startOf`) at the reading. */
  start: string;
  args: string[];
}

/**
 * The processes a fake root owns (014-32, review B3): those whose environment holds the root's
 * own `FAKE_LOG` entry, exactly. Every process of its cells inherits it, the runner's, the
 * session's and the fake daemons, and nothing else has it; a command line that names the root, a
 * path in it or a sibling's says nothing about who owns the process. Empty where `/proc` cannot
 * be read, so nothing is killed on a weaker reading.
 */
export function cellProcesses(f: { log: string }): CellProcess[] {
  const entry = `FAKE_LOG=${f.log}`;
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const pid = Number(name);
    if (!/^\d+$/.test(name) || pid === process.pid) return [];
    try {
      if (!readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(entry)) return [];
      const start = startOf(pid);
      const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      return start === null ? [] : [{ pid, start, args }];
    } catch {
      return []; // It ended, or it is not this user's to read.
    }
  });
}

/** SIGKILL to a process of the cell while its pid still holds the process read (`start`). */
export function killCellProcess({ pid, start }: CellProcess): void {
  if (startOf(pid) !== start) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // It ended after the check.
  }
}
