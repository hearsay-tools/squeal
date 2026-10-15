import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { RunnerAdapter, RunOptions, TestFileRef } from "../types/index.js";
import { lowerWhile } from "./low-priority.js";
import {
  childrenOf,
  describe,
  exited,
  GRACE_MS,
  lifeOf,
  type ProcessEntry,
  type StopNote,
  type Stopped,
  statOf,
  TICKS_PER_SECOND,
  terminate,
  uptimeTicks,
} from "./terminate.js";

export type { ProcessEntry } from "./terminate.js";

/**
 * The variable every Vitest worker of a daemon carries, and with it every
 * process a test starts with its env, wherever it ends up (spec 001 D12;
 * lessons 003, defect 8; task 001-142). Its value is the daemon's token and
 * the lane of the run, `<token>:<lane>` (task 004-18).
 */
export const CHILD_VARIABLE = "SQUEAL_DAEMON_CHILD";

/** Scans per stop: each after the first finds the orphans of what the one before stopped. */
const ROUNDS = 3;
/** `/proc/<pid>/stat` files read per event-loop turn. */
const CHUNK = 64;
/**
 * Finds and stops the processes a daemon's tests left behind (spec 001 D12).
 * Two kinds are a test's: a process carrying the daemon's mark, which only
 * the daemon's test workers get and which nothing else of the daemon runs
 * while no tier does; and a member of the daemon's own process group that no
 * longer descends from the daemon, which only a child whose parent exited
 * is. The group counts only when the daemon leads it (`squeal daemon`
 * spawned detached); a daemon inside another process's group leaves the
 * group alone. What shared the group when the daemon started, such as the
 * rest of a shell pipeline, is never the daemon's, and neither is what it
 * starts. The mark names the lane of the run (`envFor`), so a run's stop
 * reaches its own lane's processes only (task 004-18). A run told no lane
 * gets `envFor("")`, the mark `<token>:`, read back as lane `""`; only `env`
 * itself carries the bare mark, `<token>` alone, which reaches node:test
 * through the daemon's `childEnv` (task 003-38) wherever a run's own mark
 * does not replace it. Linux only, through `/proc`; elsewhere nothing is
 * found.
 */
export class EscapedChildren {
  /** The daemon's mark with no lane: what a runner that is told no lane gives its processes. */
  readonly env: Readonly<Record<string, string>>;
  /** The mark's start in a process's environ, whatever lane follows it. */
  readonly #needle: string;
  readonly #self: number;
  /** When the daemon started, so the exit looks no further back. */
  readonly #born: number;
  /** The group's other members at the start, by `key`; `null` when the daemon leads no group. */
  readonly #strangers: Promise<ReadonlySet<string> | null>;
  /** The marks of the daemon's children by `key`, each read once (`carriers`). */
  readonly #childMarks = new Map<string, string | null | undefined>();

  constructor(token: string = randomUUID(), self: number = process.pid) {
    this.env = { [CHILD_VARIABLE]: token };
    this.#needle = `\0${CHILD_VARIABLE}=${token}`;
    this.#self = self;
    this.#born = this.mark();
    this.#strangers = strangersOf(self);
    // Read only through `#find`, which waits for it; a failed scan leaves the group alone.
    this.#strangers.catch(() => {});
  }

  /** What the processes of a run of `lane` add to their env: the daemon's mark of that lane. */
  envFor(lane: string): Readonly<Record<string, string>> {
    return { [CHILD_VARIABLE]: `${this.env[CHILD_VARIABLE]}:${lane}` };
  }

  /** The clock `stop` compares start times with: now, a second early, in ticks since boot. */
  mark(): number {
    return Math.max(0, uptimeTicks() - TICKS_PER_SECOND);
  }

  /**
   * After a run of `lane`: stops every carrier of that lane's mark started
   * since `since`. With `alone`, no run of another lane in flight, also the
   * carriers of the bare mark (`env`) and the unmarked orphans of the
   * daemon's group since `alone`, a mark taken when the first of the
   * overlapping runs started. Never another lane's carrier: a run of it may
   * have just started (review 001-149). Resolves with a note naming them, or
   * `null`. Each is named with its run, whose record lists the tier's test
   * files: a lane's carrier with `runId`, a bare-mark carrier or a group
   * orphan with every run of `overlapped`, the runs since `alone`, as `one
   * of runs` when they are more than one (review wave-13r B1).
   */
  async afterRun(
    lane: string,
    since: number,
    alone: number | null = null,
    runId: string | null = null,
    overlapped: readonly string[] = runId === null ? [] : [runId],
  ): Promise<StopNote | null> {
    const own = runId === null ? undefined : `run ${runId}`;
    const shared = runsText(overlapped);
    const stopped = (await this.#stop({ lane, since, alone })).map(({ found, stopped }) => {
      const run = found.own ? own : shared;
      return run === undefined ? stopped : { ...stopped, run };
    });
    return describe(stopped, "a test left running after its tier");
  }

  /**
   * At exit, once the runners closed: every carrier of any lane, and every
   * other member of the group, a global setup's child among them.
   */
  async atExit(): Promise<StopNote | null> {
    const stopped = (await this.#stop(null)).map(({ stopped }) => stopped);
    return describe(stopped, "the runners left running when the daemon exited");
  }

  /**
   * The daemon's own children, every thread's, that carry `lane`'s mark and
   * started since `since`, for `lowerWhile` (001 D11 Priority, task 001-393):
   * a Vitest fork worker, or a thread worker's child, from its start. Read
   * from `/proc/<daemon>/task/<tid>/children`, a few small reads where a scan of
   * `/proc` reads every process, so it can run every 100 ms.
   */
  async carriers(lane: string, since: number): Promise<ProcessEntry[]> {
    if (process.platform !== "linux") return [];
    const all = childrenOf(this.#self).flatMap((pid) => statOf(pid) ?? []);
    const now = new Set(all.map(key));
    for (const known of this.#childMarks.keys())
      if (!now.has(known)) this.#childMarks.delete(known);
    // Read again until it is 100 ms old: until its exec, a child shows the daemon's environ.
    const execed = uptimeTicks() - TICKS_PER_SECOND / 10;
    const entries = all.filter(({ start }) => start >= since);
    const marks = await Promise.all(
      entries.map(async (entry) => {
        if (this.#childMarks.has(key(entry))) return this.#childMarks.get(key(entry));
        const mark = await this.#markOf(entry.pid);
        if (entry.start < execed) this.#childMarks.set(key(entry), mark);
        return mark;
      }),
    );
    return entries.filter((_, i) => marks[i] === lane);
  }

  /** `scope` `null` is the exit. */
  async #stop(scope: Scope | null): Promise<{ found: Found; stopped: Stopped }[]> {
    if (process.platform !== "linux") return [];
    const left = await this.#workersGone(scope);
    const stopped: { found: Found; stopped: Stopped }[] = [];
    // By identity, pid and start time, through every round (review 001-149 S2).
    const seen = new Set<string>();
    // A round's kills orphan the children of what it killed, which the next finds in the group
    // once they are gone, every thread of theirs (task 001-400).
    for (let round = 0; round < ROUNDS; round++) {
      const entries = await snapshot();
      const found = (await this.#find(entries, scope)).filter(({ entry }) => !seen.has(key(entry)));
      // The first round also stops what the wait left, the lane's forks or children exiting.
      const known = new Set(found.map(({ entry }) => key(entry)));
      if (round === 0)
        found.push(
          ...left.filter((entry) => !known.has(key(entry))).map((entry) => ({ entry, own: true })),
        );
      if (found.length === 0) break;
      for (const { entry } of found) seen.add(key(entry));
      // A round's pids are distinct, so its stopped are found by pid.
      const byPid = new Map(found.map((one) => [one.entry.pid, one]));
      for (const one of await terminate(found.map(({ entry }) => entry))) {
        const of = byPid.get(one.pid);
        if (of !== undefined) stopped.push({ found: of, stopped: one });
      }
      await gone(found.map(({ entry }) => entry));
    }
    return stopped;
  }

  /**
   * Vitest resolves a run before its workers exit, and they carry the mark:
   * the daemon's own children of the run's lane get up to the grace to be
   * gone, every thread of theirs, so their children are the reaper's when the
   * scan runs (tasks 001-395, 001-400). A child already exiting reads no
   * mark and is waited for whatever its lane. Those still there at the grace:
   * one still running, such as a thread worker's child, is stopped with the
   * rest; one still exiting is no link to the daemon (`statOf`), so its
   * children are taken as orphans, named with its pid alone.
   */
  async #workersGone(scope: Scope | null): Promise<ProcessEntry[]> {
    const since = scope?.since ?? this.#born;
    const children = childrenOf(this.#self).flatMap((pid) => {
      const life = lifeOf(pid);
      return life !== null && life.start >= since ? [life] : [];
    });
    const marks = await Promise.all(children.map(({ pid }) => this.#markOf(pid)));
    const waited = children.filter(
      (child, i) =>
        child.dying || (scope === null ? marks[i] !== undefined : marks[i] === scope.lane),
    );
    return gone(waited);
  }

  async #find(entries: readonly ProcessEntry[], scope: Scope | null): Promise<Found[]> {
    const strangers = await this.#strangers.catch(() => null);
    const descendants = descendantsOf([this.#self], entries);
    const foreign = strangers === null ? new Set<number>() : lineOf(strangers, entries);
    const others = entries.filter(({ pid }) => pid !== this.#self);
    // The earliest start any rule below reaches back to.
    const since = scope === null ? this.#born : Math.min(scope.since, scope.alone ?? scope.since);
    const marks = await Promise.all(
      others.map(({ pid, start }) => (start >= since ? this.#markOf(pid) : undefined)),
    );
    const orphaned = (entry: ProcessEntry) =>
      strangers !== null &&
      entry.pgrp === this.#self &&
      !foreign.has(entry.pid) &&
      (scope === null || !descendants.has(entry.pid));
    return others.flatMap((entry, i): Found[] => {
      const mark = marks[i];
      if (scope === null)
        return mark !== undefined || orphaned(entry) ? [{ entry, own: false }] : [];
      if (mark === scope.lane) return entry.start >= scope.since ? [{ entry, own: true }] : [];
      if (scope.alone === null || entry.start < scope.alone) return [];
      const shared = mark === null || (mark === undefined && orphaned(entry));
      return shared ? [{ entry, own: false }] : [];
    });
  }

  /**
   * The lane whose mark `pid` carries: a lane, `null` for the bare mark,
   * `undefined` for none (another daemon's, or gone).
   */
  async #markOf(pid: number): Promise<string | null | undefined> {
    let environ: string;
    try {
      environ = `\0${await readFile(`/proc/${pid}/environ`, "latin1")}\0`;
    } catch {
      // Gone, or another user's.
      return undefined;
    }
    const at = environ.indexOf(this.#needle);
    if (at < 0) return undefined;
    const rest = environ.slice(at + this.#needle.length, environ.indexOf("\0", at + 1));
    if (rest === "") return null;
    return rest.startsWith(":") ? rest.slice(1) : undefined;
  }
}

/** What a stop after a run reaches; see `EscapedChildren.afterRun`. */
interface Scope {
  readonly lane: string;
  readonly since: number;
  readonly alone: number | null;
}

/** A process a stop reaches; `own`, by the mark of the run's lane. */
interface Found {
  readonly entry: ProcessEntry;
  readonly own: boolean;
}

/** `run a`, `one of runs a, b`, or nothing for no run. */
function runsText(runs: readonly string[]): string | undefined {
  if (runs.length === 0) return undefined;
  return runs.length === 1 ? `run ${runs[0]}` : `one of runs ${runs.join(", ")}`;
}

/** What `afterEachRun` needs of `EscapedChildren`. */
export type RunSweeper = Pick<EscapedChildren, "mark" | "afterRun" | "envFor" | "carriers">;

/**
 * Stops what each run of `runner` left behind once it settles, before its
 * result is returned (001 D12; task 004-18). Each run is told its lane and
 * the mark of that lane for its processes (`RunOptions.lane`, `childEnv`),
 * so its stop reaches what its own lane started and never a run of another
 * lane in flight, which overlap (001 D5 as amended, task 001-140). What no
 * lane's mark says is whose, the bare mark and the group's orphans, is
 * stopped when the last overlapping run settles, looking back to the mark of
 * the first, and named with every overlapping run (review wave-13r B1). A
 * run's processes run at `nice` 10, a slow lane's at idle I/O too
 * (`lowerWhile`; 001 D11 Capacity, spec 004 D2).
 */
export function afterEachRun(
  runner: RunnerAdapter,
  children: RunSweeper,
  note: (stop: StopNote) => void,
): RunnerAdapter {
  let inFlight = 0;
  let first = 0;
  // The runs since `first`, in start order: whose a shared leftover may be.
  let overlapped: string[] = [];
  const lane = runner.lane?.bind(runner);
  const releaseLane = runner.releaseLane?.bind(runner);
  const recheck = runner.recheck?.bind(runner);
  const laneOf = (testFiles: readonly TestFileRef[], options: RunOptions): string =>
    options.lane ?? (testFiles[0] === undefined ? "" : (lane?.(testFiles[0]) ?? ""));
  return {
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    invalidate: (paths) => runner.invalidate(paths),
    ...(recheck === undefined ? {} : { recheck }),
    affected: (changedPaths) => runner.affected(changedPaths),
    closure: (testFile) => runner.closure(testFile),
    enumerate: (testFile) => runner.enumerate(testFile),
    testFiles: () => runner.testFiles(),
    omittedTestFiles: () => runner.omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => runner.slowWidth?.(testFiles) ?? testFiles.length,
    environment: () => runner.environment(),
    ...(lane === undefined ? {} : { lane }),
    ...(releaseLane === undefined ? {} : { releaseLane }),
    async run(testFiles, options) {
      const at = laneOf(testFiles, options);
      const since = children.mark();
      if (inFlight === 0) {
        first = since;
        overlapped = [];
      }
      if (!overlapped.includes(options.runId)) overlapped.push(options.runId);
      inFlight += 1;
      const settled = new AbortController();
      const lowering = lowerWhile(children, at, since, settled.signal);
      try {
        const childEnv = { ...options.childEnv, ...children.envFor(at) };
        return await runner.run(testFiles, { ...options, lane: at, childEnv });
      } finally {
        settled.abort();
        await lowering;
        inFlight -= 1;
        const alone = inFlight === 0 ? first : null;
        const runs = [...overlapped];
        const stop = await children
          .afterRun(at, since, alone, options.runId, runs)
          .catch(() => null);
        if (stop !== null) note(stop);
      }
    },
    close: () => runner.close(),
  };
}

/**
 * Every process `/proc` lists, zombies left out. Read synchronously, a
 * chunk per event-loop turn: on a host at load 80 with 650 processes that
 * took 30 ms in all, against 160 ms through the thread pool.
 */
async function snapshot(): Promise<ProcessEntry[]> {
  const names = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  const entries: ProcessEntry[] = [];
  for (let at = 0; at < names.length; at += CHUNK) {
    if (at > 0) await new Promise((done) => setImmediate(done));
    for (const name of names.slice(at, at + CHUNK)) {
      const entry = statOf(Number(name));
      if (entry !== null) entries.push(entry);
    }
  }
  return entries;
}

/** A process's identity across pid reuse. */
function key({ pid, start }: ProcessEntry): string {
  return `${pid}:${start}`;
}

/** The other members of the group `self` leads, or `null` when it leads none. */
async function strangersOf(self: number): Promise<ReadonlySet<string> | null> {
  if (process.platform !== "linux" || statOf(self)?.pgrp !== self) return null;
  const entries = await snapshot();
  const ours = descendantsOf([self], entries);
  const members = entries.filter(({ pid, pgrp }) => pgrp === self && pid !== self);
  return new Set(members.filter(({ pid }) => !ours.has(pid)).map(key));
}

/** The strangers still running and every descendant of theirs. */
function lineOf(strangers: ReadonlySet<string>, entries: readonly ProcessEntry[]): Set<number> {
  const roots = entries.filter((entry) => strangers.has(key(entry))).map(({ pid }) => pid);
  return new Set([...roots, ...descendantsOf(roots, entries)]);
}

function descendantsOf(roots: readonly number[], entries: readonly ProcessEntry[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of entries) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found = new Set<number>();
  const queue = roots.flatMap((root) => children.get(root) ?? []);
  for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
    if (found.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/**
 * Waits up to the grace for each of `entries` to be gone, every thread of
 * it (`exited`), and resolves with those still there.
 */
async function gone(entries: readonly ProcessEntry[]): Promise<ProcessEntry[]> {
  let left = entries.filter((entry) => !exited(entry));
  const deadline = Date.now() + GRACE_MS;
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(25);
    left = left.filter((entry) => !exited(entry));
  }
  return left;
}
