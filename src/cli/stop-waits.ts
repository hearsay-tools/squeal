import { setTimeout as sleep } from "node:timers/promises";
import { type DaemonMarks, type Leftover, leftovers } from "../core/daemon/leftovers.js";
import type { AbsolutePath } from "../core/types/common.js";
import { askDaemon } from "./daemon-access.js";

/*
 * What `squeal stop` shares between a worktree that is there and one whose
 * root was removed (row 011-277): the waits for the daemon's socket, its
 * process and the processes it started, how what is left is named, and the
 * lines both write the same.
 */

/** Waits up to `ms` for no daemon to answer at `socketPath`; whether none does. */
export async function socketClosed(socketPath: AbsolutePath, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while ((await askDaemon(socketPath, { type: "ping" }).catch(() => "busy")) !== null) {
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
  return true;
}

/** Waits up to `ms` for the processes of `marks` to be gone; those still there. */
export async function leftoversGone(marks: DaemonMarks, ms: number): Promise<Leftover[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const left = await leftovers(marks);
    if (left.length === 0 || Date.now() > deadline) return left;
    await sleep(100);
  }
}

/** The line for a daemon that answered the stop with `error`. */
export function refusedLine(error: string): string {
  return `squeal: the daemon refused to stop: ${error}\n`;
}

/** The line for the daemon of `root` that stopped while `left` still ran after a wait of `ms`. */
export function leftoverLine(root: AbsolutePath, left: readonly Leftover[], ms: number): string {
  return `Stop requested; the daemon for ${root} stopped, but ${leftoversClause(left, seconds(ms))}\n`;
}

/** What of `left` still runs `after` the wait, and each by pid and command line. */
function leftoversClause(left: readonly Leftover[], after: string): string {
  const named = left.map(({ pid, args }) => `pid ${pid} ${args}`.trim()).join("; ");
  const what =
    left.length === 1
      ? "a process it started still runs"
      : `${left.length} processes it started still run`;
  return `${what} after ${after}: ${named}`;
}

export function seconds(ms: number): string {
  return `${ms / 1_000} s`;
}

/** No process `pid` exists here: signal 0 finds none. */
export function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
