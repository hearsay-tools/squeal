import { execFile } from "node:child_process";
import { getPriority, setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { isSlowLane } from "../types/index.js";
import type { EscapedChildren } from "./escaped.js";

/**
 * Every test process Squeal starts runs with `nice` 10 (001 D11 Capacity,
 * Priority, task 001-378), as a slow file's did first (spec 004 D2).
 */
export const TEST_NICE = 10;

/** The first look after a run starts, then every `EVERY_MS`: a worker starts with the run. */
const FIRST_MS = 250;
const EVERY_MS = 1_000;

/**
 * Every lane's run at `nice` 10 (001 D11 Capacity, task 001-378), and a
 * slow lane's also, on Linux, at `ionice -c 3` where permitted (spec 004
 * D2). The run's processes are found by the mark of its lane
 * among the daemon's descendants and its group's orphans
 * (`EscapedChildren.carriers`), a fork pool's workers and what a test
 * starts with their env, and each is lowered once, until `signal` aborts.
 * What a lowered process starts later inherits its priority. A thread
 * pool's workers are threads of the daemon and carry no mark of their own:
 * they keep the daemon's priority. A process starts at normal priority and
 * runs so until the next look, at most `EVERY_MS`. Never rejects.
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
    for (let wait = FIRST_MS; ; wait = EVERY_MS) {
      await sleep(wait, undefined, { signal });
      const found = await children.carriers(lane, since);
      const fresh = found.filter((entry) => !lowered.has(`${entry.pid}:${entry.start}`));
      for (const entry of fresh) lowered.add(`${entry.pid}:${entry.start}`);
      if (fresh.length > 0)
        lower(
          fresh.map((entry) => entry.pid),
          isSlowLane(lane),
        );
    }
  } catch {
    // Aborted: the run settled.
  }
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
