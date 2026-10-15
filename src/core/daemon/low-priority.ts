import { execFile } from "node:child_process";
import { getPriority, setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { isSlowLane } from "../types/index.js";
import type { EscapedChildren } from "./escaped.js";
import { childrenOf } from "./terminate.js";

/**
 * Every test process Squeal starts runs with `nice` 10 (001 D11 Capacity,
 * Priority, task 001-378), as a slow file's did first (spec 004 D2).
 */
export const TEST_NICE = 10;

/** How often a run's new processes are looked for: a short fork lives a few hundred ms. */
const EVERY_MS = 100;

/**
 * Every lane's run at `nice` 10 (001 D11 Capacity, Priority, task 001-378),
 * and a slow lane's also, on Linux, at `ionice -c 3` where permitted (spec
 * 004 D2). Every `EVERY_MS` after the last look ended, until `signal`
 * aborts, the daemon's own children carrying the mark of the run's lane
 * (`EscapedChildren.carriers`), a fork pool's workers and a thread worker's
 * children, are lowered once, each with what it has started so far; what a
 * lowered process starts later inherits its priority (task 001-393). So are
 * the carriers in the daemon's group whose parent exited before a look,
 * found at most once a second after a child of the daemon exits (review
 * 001-401 S1). A thread pool's workers are threads of the daemon and carry no
 * mark of their own: they keep the daemon's priority. A process starts at
 * normal priority and runs so until the next look: `EVERY_MS` plus the look's
 * own time, no deadline. Never rejects.
 */
export async function lowerWhile(
  children: Pick<EscapedChildren, "carriers">,
  lane: string,
  since: number,
  signal: AbortSignal,
): Promise<void> {
  if (process.platform !== "linux") return;
  const lowered = new Set<string>();
  try {
    for (;;) {
      await sleep(EVERY_MS, undefined, { signal });
      const found = await children.carriers(lane, since);
      const fresh = found.filter((entry) => !lowered.has(`${entry.pid}:${entry.start}`));
      for (const entry of fresh) lowered.add(`${entry.pid}:${entry.start}`);
      if (fresh.length > 0)
        lower(
          fresh.flatMap(({ pid }) => [pid, ...below(pid)]),
          isSlowLane(lane),
        );
    }
  } catch {
    // Aborted: the run settled.
  }
}

/** Every descendant `pid` has now. */
function below(pid: number): number[] {
  const found: number[] = [];
  for (let queue = childrenOf(pid), next = queue.pop(); next !== undefined; next = queue.pop()) {
    found.push(next);
    queue.push(...childrenOf(next));
  }
  return found;
}

/** `nice` 10 where it lowers; a process gone or not ours is skipped. */
export function lowerProcess(pid: number): void {
  try {
    if (getPriority(pid) < TEST_NICE) setPriority(pid, TEST_NICE);
  } catch {
    // Gone, or not permitted.
  }
}

/** Each at `nice` 10, then, when `idle`, `ionice -c 3` for all at once. */
function lower(pids: readonly number[], idle: boolean): void {
  for (const pid of pids) lowerProcess(pid);
  if (!idle) return;
  execFile("ionice", ["-c", "3", "-p", ...pids.map(String)], () => {
    // Missing, or not permitted: `nice` alone.
  }).unref();
}
