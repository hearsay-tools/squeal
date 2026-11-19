import { type ExecFileException, execFile } from "node:child_process";
import { getPriority, setPriority } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type { CheckPriority } from "../types/check-groups.js";
import { isSlowLane } from "../types/runner.js";
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
 * The priority of a run in `lane` (spec 019 D3, row 019-12): the one it
 * names, else `"low"` in a slow lane, as before groups (spec 004 D2), and
 * `"normal"` in any other.
 */
export function runPriority(named: CheckPriority | undefined, lane: string): CheckPriority {
  return named ?? (isSlowLane(lane) ? "low" : "normal");
}

/**
 * Every lane's run at `nice` 10 (001 D11 Capacity, Priority, task 001-378),
 * and a `"low"` run's also, on Linux, at `ionice -c 3` where permitted (spec
 * 004 D2; 019 D3, row 019-12: by the run's priority, not its lane). Every
 * `EVERY_MS` after the last look ended, until `signal`
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
 * a test. Only `signal` ends it (row 011-410): an error from `carriers` or
 * from one carrier's `walk` goes to `report`, the daemon's stderr but in a
 * test, once per message in this process, and the next look tries again;
 * `lost` stays set and a carrier whose walk failed is walked again, so what
 * the failed look missed is found then. Never rejects.
 */
export async function lowerWhile(
  children: Pick<EscapedChildren, "carriers">,
  lane: string,
  priority: CheckPriority,
  since: number,
  signal: AbortSignal,
  walk: (pid: number) => Identity[] = below,
  report: (message: string) => void = toStderr,
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
  const failed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (reported.has(message) || reported.size >= REPORTED_MAX) return;
    reported.add(message);
    report(
      `squeal: lowering the test processes of ${lane} failed, the next look retries: ${message}`,
    );
  };
  while (!signal.aborted) {
    try {
      await sleep(EVERY_MS, undefined, { signal });
    } catch {
      return; // Aborted: the run settled.
    }
    try {
      const fresh: Identity[] = [];
      try {
        const found = await children.carriers(lane, since, lost);
        lost = false;
        const at = Date.now();
        for (const { pid, start } of found)
          if (!lowered.has(`${pid}:${start}`)) {
            lowered.set(`${pid}:${start}`, { pid, start, since: at, walked: 0, seen: new Set() });
            fresh.push({ pid, start });
          }
      } catch (error) {
        if (signal.aborted) return;
        failed(error);
      }
      const at = Date.now();
      for (const [id, carrier] of lowered) {
        if (at - carrier.since >= WALK_MS && at - carrier.walked < WALK_MS) continue;
        if (statOf(carrier.pid)?.start !== carrier.start) {
          lowered.delete(id);
          lost = true;
          continue;
        }
        let descendants: Identity[];
        try {
          descendants = walk(carrier.pid);
        } catch (error) {
          failed(error);
          continue;
        }
        carrier.walked = at;
        const current = new Set<string>();
        for (const descendant of descendants) {
          const id = `${descendant.pid}:${descendant.start}`;
          current.add(id);
          if (!carrier.seen.has(id)) fresh.push(descendant);
        }
        for (const id of carrier.seen) if (!current.has(id)) lost = true;
        carrier.seen = current;
      }
      if (fresh.length > 0) lower(fresh, priority === "low");
    } catch (error) {
      if (signal.aborted) return;
      failed(error);
    }
  }
}

/**
 * The messages `lowerWhile` reported in this process: each once, and none past
 * the first `REPORTED_MAX`, as a message naming a pid can differ every look.
 */
const reported = new Set<string>();
const REPORTED_MAX = 100;

function toStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** A process by its pid and its start, as `statOf` reads them. */
export type Identity = Pick<ProcessEntry, "pid" | "start">;

/**
 * Every descendant `pid` has now, but one already exiting: a child killed
 * and not yet reaped is skipped, not an error (row 011-409).
 */
export function below(pid: number): Identity[] {
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
 * gone by then or not ours, so a failed batch is retried one pid at a time,
 * each only while it is still the process it named: a pid freed during the
 * batch may name another's by then (review wave-18, pre-existing
 * limitations; review wave-1.13 B1).
 */
function lower(processes: readonly Identity[], idle: boolean): void {
  const same = ({ pid, start }: Identity) => statOf(pid)?.start === start;
  const live = processes.filter(same);
  for (const { pid } of live) lowerProcess(pid);
  if (!idle || live.length === 0) return;
  idleIo(
    live.map(({ pid }) => pid),
    (error) => {
      // Missing: `nice` alone.
      if (error === null || error.code === "ENOENT" || live.length === 1) return;
      for (const process of live) if (same(process)) idleIo([process.pid], () => {});
    },
  );
}

/** `ionice -c 3` for `pids`, then `done` with how it ended. */
function idleIo(pids: readonly number[], done: (error: ExecFileException | null) => void): void {
  execFile("ionice", ["-c", "3", "-p", ...pids.map(String)], done).unref();
}
