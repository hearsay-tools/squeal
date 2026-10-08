import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isSlowLane,
  type RunnerAdapter,
  type RunOptions,
  type TestFileRef,
} from "../types/index.js";
import { lowerWhile } from "./low-priority.js";

/**
 * The variable every Vitest worker of a daemon carries, and with it every
 * process a test starts with its env, wherever it ends up (spec 001 D12;
 * lessons 003, defect 8; task 001-142). Its value is the daemon's token and
 * the lane of the run, `<token>:<lane>` (task 004-18).
 */
export const CHILD_VARIABLE = "SQUEAL_DAEMON_CHILD";

/** How long a process told to stop gets before it is killed. */
const GRACE_MS = 1_000;
/** `/proc` reports start times in USER_HZ, 100 on every Linux architecture Node supports. */
const TICKS_PER_SECOND = 100;
/** Scans per stop: each after the first finds the orphans of what the one before stopped. */
const ROUNDS = 3;
/** `/proc/<pid>/stat` files read per event-loop turn. */
const CHUNK = 64;
/** The longest command line a note names. */
const COMMAND_CHARS = 120;

export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  /** Clock ticks since boot. */
  readonly start: number;
}

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
 * reaches its own lane's processes only (task 004-18). Linux only, through
 * `/proc`; elsewhere nothing is found.
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
   * `null`.
   */
  async afterRun(lane: string, since: number, alone: number | null = null): Promise<string | null> {
    const stopped = await this.#stop({ lane, since, alone });
    return describe(stopped, "a test left running after its tier");
  }

  /**
   * At exit, once the runners closed: every carrier of any lane, and every
   * other member of the group, a global setup's child among them.
   */
  async atExit(): Promise<string | null> {
    const stopped = await this.#stop(null);
    return describe(stopped, "the runners left running when the daemon exited");
  }

  /** The carriers of `lane`'s mark started since `since`, for `lowerWhile` (spec 004 D2). */
  async carriers(lane: string, since: number): Promise<ProcessEntry[]> {
    if (process.platform !== "linux") return [];
    const entries = (await snapshot()).filter((e) => e.pid !== this.#self && e.start >= since);
    const marks = await Promise.all(entries.map(({ pid }) => this.#markOf(pid)));
    return entries.filter((_, i) => marks[i] === lane);
  }

  /** `scope` `null` is the exit. */
  async #stop(scope: Scope | null): Promise<Stopped[]> {
    if (process.platform !== "linux") return [];
    let entries = await snapshot();
    if (await this.#workersGone(entries, scope)) entries = await snapshot();
    const stopped: Stopped[] = [];
    // By identity, pid and start time, through every round (review 001-149 S2).
    const seen = new Set<string>();
    // A round's kills orphan the children of what it killed, which the next finds in the group.
    for (let round = 0; round < ROUNDS; round++) {
      if (round > 0) entries = await snapshot();
      const found = (await this.#find(entries, scope)).filter((entry) => !seen.has(key(entry)));
      if (found.length === 0) break;
      for (const entry of found) seen.add(key(entry));
      stopped.push(...(await terminate(found)));
    }
    return stopped;
  }

  /**
   * Vitest resolves a run before its workers exit, and they carry the mark:
   * the daemon's own children of the run's lane get up to the grace to go
   * first. One still there, such as a thread worker's child, is stopped with
   * the rest. Whether there were any to wait for.
   */
  async #workersGone(entries: readonly ProcessEntry[], scope: Scope | null): Promise<boolean> {
    const since = scope?.since ?? this.#born;
    const children = entries.filter(({ ppid, start }) => ppid === this.#self && start >= since);
    const marks = await Promise.all(children.map(({ pid }) => this.#markOf(pid)));
    const carrying = marks.map((mark) =>
      scope === null ? mark !== undefined : mark === scope.lane,
    );
    let alive = children.filter((_, i) => carrying[i]);
    if (alive.length === 0) return false;
    const deadline = Date.now() + GRACE_MS;
    while (alive.length > 0 && Date.now() < deadline) {
      await sleep(25);
      alive = survivors(alive);
    }
    return true;
  }

  async #find(entries: readonly ProcessEntry[], scope: Scope | null): Promise<ProcessEntry[]> {
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
    return others.filter((entry, i) => {
      const mark = marks[i];
      if (scope === null) return mark !== undefined || orphaned(entry);
      if (mark === scope.lane) return entry.start >= scope.since;
      if (scope.alone === null || entry.start < scope.alone) return false;
      return mark === null || (mark === undefined && orphaned(entry));
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
 * the first. A slow lane's processes run at low priority (`lowerWhile`,
 * spec 004 D2).
 */
export function afterEachRun(
  runner: RunnerAdapter,
  children: RunSweeper,
  note: (text: string) => void,
): RunnerAdapter {
  let inFlight = 0;
  let first = 0;
  const lane = runner.lane?.bind(runner);
  const releaseLane = runner.releaseLane?.bind(runner);
  const laneOf = (testFiles: readonly TestFileRef[], options: RunOptions): string =>
    options.lane ?? (testFiles[0] === undefined ? "" : (lane?.(testFiles[0]) ?? ""));
  return {
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    invalidate: (paths) => runner.invalidate(paths),
    affected: (changedPaths) => runner.affected(changedPaths),
    closure: (testFile) => runner.closure(testFile),
    enumerate: (testFile) => runner.enumerate(testFile),
    testFiles: () => runner.testFiles(),
    environment: () => runner.environment(),
    ...(lane === undefined ? {} : { lane }),
    ...(releaseLane === undefined ? {} : { releaseLane }),
    async run(testFiles, options) {
      const at = laneOf(testFiles, options);
      const since = children.mark();
      if (inFlight === 0) first = since;
      inFlight += 1;
      const settled = new AbortController();
      const lowering = isSlowLane(at) ? lowerWhile(children, at, since, settled.signal) : null;
      try {
        const childEnv = { ...options.childEnv, ...children.envFor(at) };
        return await runner.run(testFiles, { ...options, lane: at, childEnv });
      } finally {
        settled.abort();
        await lowering;
        inFlight -= 1;
        const alone = inFlight === 0 ? first : null;
        const text = await children.afterRun(at, since, alone).catch(() => null);
        if (text !== null) note(text);
      }
    },
    close: () => runner.close(),
  };
}

/** SIGTERM, up to the grace to go, then SIGKILL. */
/** What `terminate` reads and signals; `PROC` on Linux, a table of its own in tests. */
export interface ProcessTable {
  /** The process now at `pid`, or `null` when none is. */
  stat(pid: number): ProcessEntry | null;
  commandLine(pid: number): Promise<string>;
  signal(pid: number, name: NodeJS.Signals): void;
}

const PROC: ProcessTable = { stat: statOf, commandLine, signal };

/**
 * SIGTERM, up to the grace to go, then SIGKILL. Each signal and the command
 * line a note names reach a process only while the pid still holds the one
 * the scan found, same start time, checked right before (review 001-149 S2):
 * a pid reused in between gets nothing and is not named. Between the check
 * and the signal the pid can still be reused; a pidfd would close that, at
 * the cost of a native call Node does not expose.
 */
export async function terminate(
  found: readonly ProcessEntry[],
  table: ProcessTable = PROC,
): Promise<Stopped[]> {
  const same = (entry: ProcessEntry) => table.stat(entry.pid)?.start === entry.start;
  const named: { entry: ProcessEntry; args: string }[] = [];
  for (const entry of found) {
    if (!same(entry)) continue;
    named.push({ entry, args: await table.commandLine(entry.pid) });
  }
  const termed = named.filter(({ entry }) => same(entry)).map(({ entry }) => entry);
  for (const { pid } of termed) table.signal(pid, "SIGTERM");
  const deadline = Date.now() + GRACE_MS;
  let alive = termed.filter(same);
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(25);
    alive = alive.filter(same);
  }
  for (const entry of alive) if (same(entry)) table.signal(entry.pid, "SIGKILL");
  const stopped = new Set(termed);
  return named
    .filter(({ entry }) => stopped.has(entry))
    .map(({ entry, args }) => ({ pid: entry.pid, args }));
}

export interface Stopped {
  readonly pid: number;
  readonly args: string;
}

function describe(stopped: readonly Stopped[], what: string): string | null {
  if (stopped.length === 0) return null;
  const count = stopped.length === 1 ? "1 process" : `${stopped.length} processes`;
  const list = stopped.map(({ pid, args }) => `${pid} ${args}`.trimEnd()).join("; ");
  return `stopped ${count} ${what}: ${list}`;
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

function statOf(pid: number): ProcessEntry | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "latin1");
  } catch {
    return null;
  }
  // The command name is in parentheses and may hold either; the fields follow the last one.
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return null;
  return { pid, ppid: Number(fields[1]), pgrp: Number(fields[2]), start: Number(fields[19]) };
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

/** The ones still running as the same process: same pid, same start time. */
function survivors(entries: readonly ProcessEntry[]): ProcessEntry[] {
  return entries.filter((entry) => statOf(entry.pid)?.start === entry.start);
}

async function commandLine(pid: number): Promise<string> {
  try {
    const text = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
    return text.length > COMMAND_CHARS ? `${text.slice(0, COMMAND_CHARS - 3)}...` : text;
  } catch {
    return "";
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

function uptimeTicks(): number {
  if (process.platform !== "linux") return 0;
  try {
    // Synchronous: one small read, at construction and before each tier.
    return Math.floor(
      Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * TICKS_PER_SECOND,
    );
  } catch {
    return 0;
  }
}
