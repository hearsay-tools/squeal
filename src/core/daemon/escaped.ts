import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { RunnerAdapter, RunOptions, RunReport, TestFileRef } from "../types/index.js";
import { focusesFile } from "./composite-runner.js";
import { lowerWhile } from "./low-priority.js";
import { outlivedNote } from "./outlived.js";
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
 * the lane of the run, `<token>:<lane>` (task 004-18), or of the run itself,
 * `<token>:<lane>#<runId>`, where runs of a lane overlap (`afterEachRun`,
 * task 011-21).
 */
export const CHILD_VARIABLE = "SQUEAL_DAEMON_CHILD";

/** Scans per stop: each after the first finds the orphans of what the one before stopped. */
const ROUNDS = 3;
/** `/proc/<pid>/stat` files read per event-loop turn. */
const CHUNK = 64;
/** The least time between two scans for a run's orphans (`carriers`). */
const ORPHANS_EVERY_MS = 1_000;
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
  /** The daemon's `reapedFaults` at the last scan for orphans, and when it ran (`carriers`). */
  #reaped = -1;
  #orphansAt = 0;
  /** What the last scan for orphans found, every lane's, by `key`, with its mark (`carriers`). */
  #orphanMarks = new Map<string, { entry: ProcessEntry; mark: string | null | undefined }>();

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
   * A stop's cancel past its grace (D10, task 001-367): every carrier of the
   * mark, any lane's, while the runners are still open. The group's unmarked
   * members, such as esbuild's service, wait for the exit.
   */
  async stopMarked(): Promise<StopNote | null> {
    const stopped = (await this.#stop("marked")).map(({ stopped }) => stopped);
    return describe(stopped, "a test still running when squeal stop cancelled its tier");
  }

  /**
   * The daemon's own children, every thread's, that carry `lane`'s mark and
   * started since `since`, for `lowerWhile` (001 D11 Priority, task 001-393):
   * a Vitest fork worker, or a thread worker's child, from its start. Read
   * from `/proc/<daemon>/task/<tid>/children`, a few small reads where a scan of
   * `/proc` reads every process, so it can run every 100 ms. Also, after a
   * child of the daemon exited, the lane's carriers in its group that its
   * children left behind (`#orphans`, review 001-401 S1), or, when `lost`, a
   * descendant `lowerWhile` walked that is gone (review wave-18 B1).
   */
  async carriers(lane: string, since: number, lost = false): Promise<ProcessEntry[]> {
    if (process.platform !== "linux") return [];
    // Not equal to any count read: the next scan the least interval allows runs.
    if (lost) this.#reaped = Number.NaN;
    const children = await this.#children(lane, since);
    const known = new Set(children.map(key));
    const orphans = await this.#orphans(lane, since);
    return [...children, ...orphans.filter((entry) => !known.has(key(entry)))];
  }

  async #children(lane: string, since: number): Promise<ProcessEntry[]> {
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

  /**
   * The members of the daemon's group carrying `lane`'s mark, started since
   * `since`, that are no children of the daemon: a child that exited before a
   * look found it leaves its children there. Scanned from `/proc` only when
   * a child of the daemon was reaped since the last scan, which its children's
   * page faults, added to the daemon's `cminflt`, tell, or a lowered process
   * was lost (`carriers`), and at most once in
   * `ORPHANS_EVERY_MS`, whatever lane looks. A scan keeps what it found of
   * every lane, so a lane's look between scans still gets its own (review
   * wave-13bt S1). None when the daemon leads no group.
   */
  async #orphans(lane: string, since: number): Promise<ProcessEntry[]> {
    const reaped = reapedFaults(this.#self);
    if (reaped !== this.#reaped && Date.now() - this.#orphansAt >= ORPHANS_EVERY_MS) {
      this.#reaped = reaped;
      this.#orphansAt = Date.now();
      await this.#scanOrphans();
    }
    const found: ProcessEntry[] = [];
    for (const { entry, mark } of this.#orphanMarks.values())
      if (mark === lane && entry.start >= since && statOf(entry.pid)?.start === entry.start)
        found.push(entry);
    return found;
  }

  /** The group's members that are no children of the daemon, each lane's, into `#orphanMarks`. */
  async #scanOrphans(): Promise<void> {
    const strangers = await this.#strangers.catch(() => null);
    if (strangers === null) return;
    const entries = await snapshot();
    const foreign = lineOf(strangers, entries);
    const members = entries.filter(
      (e) =>
        e.pgrp === this.#self &&
        e.pid !== this.#self &&
        e.ppid !== this.#self &&
        !foreign.has(e.pid),
    );
    const marks = await Promise.all(
      members.map(async (entry) => {
        const known = this.#orphanMarks.get(key(entry));
        return known === undefined ? await this.#markOf(entry.pid) : known.mark;
      }),
    );
    this.#orphanMarks = new Map(members.map((entry, i) => [key(entry), { entry, mark: marks[i] }]));
  }

  /** `scope` `null` is the exit; `"marked"`, a stop's cancel (`stopMarked`). */
  async #stop(scope: Sweep): Promise<{ found: Found; stopped: Stopped }[]> {
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
  async #workersGone(scope: Sweep): Promise<ProcessEntry[]> {
    const lane = typeof scope === "object" ? scope : null;
    const since = lane?.since ?? this.#born;
    const children = childrenOf(this.#self).flatMap((pid) => {
      const life = lifeOf(pid);
      return life !== null && life.start >= since ? [life] : [];
    });
    const marks = await Promise.all(children.map(({ pid }) => this.#markOf(pid)));
    const waited = children.filter(
      (child, i) =>
        child.dying || (lane === null ? marks[i] !== undefined : marks[i] === lane.lane),
    );
    return gone(waited);
  }

  async #find(entries: readonly ProcessEntry[], sweep: Sweep): Promise<Found[]> {
    const others = entries.filter(({ pid }) => pid !== this.#self);
    if (sweep === "marked") {
      const marks = await Promise.all(
        others.map(({ pid, start }) => (start >= this.#born ? this.#markOf(pid) : undefined)),
      );
      return others.flatMap((entry, i) => (marks[i] === undefined ? [] : [{ entry, own: false }]));
    }
    const scope = sweep;
    const strangers = await this.#strangers.catch(() => null);
    const descendants = descendantsOf([this.#self], entries);
    const foreign = strangers === null ? new Set<number>() : lineOf(strangers, entries);
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

/** What a stop reaches: after a run, every carrier at a stop's cancel, or `null`, the exit. */
type Sweep = Scope | "marked" | null;

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

/** A note `afterEachRun` writes: a stop's, or one that names what it left running (row 011-245). */
export type RunNote = Pick<StopNote, "text"> & Partial<Pick<StopNote, "stopped">>;

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
 * (`lowerWhile`; 001 D11 Capacity, spec 004 D2). A runner whose runs of one
 * lane overlap (`besideBacklog`: an edit's tier beside a backlog tier, spec
 * 011 C4 step 5 as amended, task 011-21) gives each run's processes a mark
 * of their own, `<lane>#<runId>`, so one run's stop never reaches the
 * other's. After the stop, what a run cut by its forced cancel left
 * (`RunReport.outlived`) and is still running is named in a note of its
 * own and stopped by nothing (row 011-245).
 */
export function afterEachRun(
  runner: RunnerAdapter,
  children: RunSweeper,
  note: (note: RunNote) => void,
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
    tierWidth: (testFile, grant) => runner.tierWidth?.(testFile, grant) ?? grant,
    tierPart: (testFile) => runner.tierPart?.(testFile) ?? "",
    besideBacklog: (testFile) => runner.besideBacklog?.(testFile) ?? false,
    backlogSlot: (testFile) => runner.backlogSlot?.(testFile) ?? null,
    focusesFile: (testFile) => focusesFile(runner, testFile),
    environment: () => runner.environment(),
    ...(lane === undefined ? {} : { lane }),
    ...(releaseLane === undefined ? {} : { releaseLane }),
    async run(testFiles, options) {
      const at = laneOf(testFiles, options);
      const lead = testFiles[0];
      const overlaps = lead !== undefined && runner.besideBacklog?.(lead) === true;
      const mark = overlaps ? `${at}#${options.runId}` : at;
      const since = children.mark();
      if (inFlight === 0) {
        first = since;
        overlapped = [];
      }
      if (!overlapped.includes(options.runId)) overlapped.push(options.runId);
      inFlight += 1;
      const settled = new AbortController();
      const lowering = lowerWhile(children, mark, since, settled.signal);
      let report: RunReport | undefined;
      try {
        const childEnv = { ...options.childEnv, ...children.envFor(mark) };
        report = await runner.run(testFiles, { ...options, lane: at, childEnv });
        return report;
      } finally {
        settled.abort();
        await lowering;
        inFlight -= 1;
        const alone = inFlight === 0 ? first : null;
        const runs = [...overlapped];
        const stop = await children
          .afterRun(mark, since, alone, options.runId, runs)
          .catch(() => null);
        if (stop !== null) note(stop);
        const left = await outlivedNote(report?.outlived ?? [], options.runId).catch(() => null);
        if (left !== null) note({ text: left });
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

/**
 * `cminflt` of `/proc/<pid>/stat`: the page faults of its children it has
 * reaped, which grows with every child that exits; -1 when unreadable.
 */
function reapedFaults(pid: number): number {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[8] ?? -1);
  } catch {
    return -1;
  }
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
