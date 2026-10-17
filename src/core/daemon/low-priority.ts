import { type ExecFileException, execFile } from "node:child_process";
import { getPriority, setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { isSlowLane } from "../types/index.js";
import type { EscapedChildren } from "./escaped.js";
import { childrenOf, type ProcessEntry, statOf } from "./terminate.js";

/**
 * Every test process Squeal starts runs with `nice` 10 (001 D11 Capacity,
 * Priority, task 001-378), as a slow file's did first (spec 004 D2).
 */
export const TEST_NICE = 10;

/** How often a run's new processes are looked for: a short fork lives a few hundred ms. */
const EVERY_MS = 100;

/**
 * A lowered carrier is walked on every look for its first `WALK_MS`, then
 * once every `WALK_MS` while it lives: a child it was forking when lowered
 * is listed only once made, under load a few hundred ms later (task 001-437).
 */
const WALK_MS = 1_000;

/**
 * Every lane's run at `nice` 10 (001 D11 Capacity, Priority, task 001-378),
 * and a slow lane's also, on Linux, at `ionice -c 3` where permitted (spec
 * 004 D2). Every `EVERY_MS` after the last look ended, until `signal`
 * aborts, the daemon's own children carrying the mark of the run's lane
 * (`EscapedChildren.carriers`), a fork pool's workers and a thread worker's
 * children, are lowered once, each with what it has started so far; what a
 * lowered process starts later inherits its priority (task 001-393). A child
 * it was still forking then kept the priority it had and is listed only once
 * made, so every lowered carrier's descendants are walked again, on every
 * look for its first `WALK_MS` and then once every `WALK_MS` while it lives,
 * and what is new is lowered (task 001-437). So are
 * the carriers in the daemon's group whose parent exited before a look,
 * found at most once a second after a child of the daemon exits (review
 * 001-401 S1), or a lowered carrier or a descendant a walk listed is gone:
 * a child it was forking when its own walk ran is in the group now, no
 * longer below the carrier (review wave-18 B1). A descendant is known by its
 * pid and start, so a pid reused between two walks reads new, and a process
 * is lowered only while its pid and start still match (review wave-18 S1).
 * A thread pool's workers are threads of the daemon and carry no
 * mark of their own: they keep the daemon's priority. A process starts at
 * normal priority and runs so until the next look: `EVERY_MS` plus the look's
 * own time, no deadline. `walk` lists a process's descendants, `below` but in
 * a test. Never rejects.
 */
export async function lowerWhile(
  children: Pick<EscapedChildren, "carriers">,
  lane: string,
  since: number,
  signal: AbortSignal,
  walk: (pid: number) => Identity[] = below,
): Promise<void> {
  if (process.platform !== "linux") return;
  // Each lowered carrier while it lives, by pid and start: when it was lowered and last
  // walked, and its descendants at that walk.
  const lowered = new Map<
    string,
    { pid: number; start: number; since: number; walked: number; seen: Set<string> }
  >();
  // A descendant a walk listed is gone: what it started may be in the daemon's group now.
  let lost = false;
  try {
    for (;;) {
      await sleep(EVERY_MS, undefined, { signal });
      const found = await children.carriers(lane, since, lost);
      lost = false;
      const at = Date.now();
      const fresh: Identity[] = [];
      for (const { pid, start } of found)
        if (!lowered.has(`${pid}:${start}`)) {
          lowered.set(`${pid}:${start}`, { pid, start, since: at, walked: 0, seen: new Set() });
          fresh.push({ pid, start });
        }
      for (const [id, carrier] of lowered) {
        if (at - carrier.since >= WALK_MS && at - carrier.walked < WALK_MS) continue;
        if (statOf(carrier.pid)?.start !== carrier.start) {
          lowered.delete(id);
          lost = true;
          continue;
        }
        carrier.walked = at;
        const current = new Set<string>();
        for (const descendant of walk(carrier.pid)) {
          const id = `${descendant.pid}:${descendant.start}`;
          current.add(id);
          if (!carrier.seen.has(id)) fresh.push(descendant);
        }
        for (const id of carrier.seen) if (!current.has(id)) lost = true;
        carrier.seen = current;
      }
      if (fresh.length > 0) lower(fresh, isSlowLane(lane));
    }
  } catch {
    // Aborted: the run settled.
  }
}

/** A process by its pid and its start, as `statOf` reads them. */
export type Identity = Pick<ProcessEntry, "pid" | "start">;

/** Every descendant `pid` has now, but one already exiting. */
function below(pid: number): Identity[] {
  const found: Identity[] = [];
  for (let queue = childrenOf(pid), next = queue.pop(); next !== undefined; next = queue.pop()) {
    const entry = statOf(next);
    if (entry !== null) found.push({ pid: next, start: entry.start });
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

/**
 * Each still the process it names at `nice` 10, then, when `idle`, `ionice
 * -c 3` for all at once. `ionice` stops at the first pid it cannot set, one
 * gone by then or not ours, so a failed batch is retried one pid at a time
 * (review wave-18, pre-existing limitations).
 */
function lower(processes: readonly Identity[], idle: boolean): void {
  const pids = processes
    .filter(({ pid, start }) => statOf(pid)?.start === start)
    .map(({ pid }) => pid);
  for (const pid of pids) lowerProcess(pid);
  if (!idle || pids.length === 0) return;
  idleIo(pids, (error) => {
    // Missing: `nice` alone.
    if (error === null || error.code === "ENOENT" || pids.length === 1) return;
    for (const pid of pids) idleIo([pid], () => {});
  });
}

/** `ionice -c 3` for `pids`, then `done` with how it ended. */
function idleIo(pids: readonly number[], done: (error: ExecFileException | null) => void): void {
  execFile("ionice", ["-c", "3", "-p", ...pids.map(String)], done).unref();
}
