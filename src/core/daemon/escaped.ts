import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { RunnerAdapter } from "../types/index.js";

/**
 * The variable every Vitest worker of a daemon carries, and with it every
 * process a test starts with its env, wherever it ends up (spec 001 D12;
 * lessons 003, defect 8; task 001-142).
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

interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgrp: number;
  /** Clock ticks since boot. */
  readonly start: number;
}

/**
 * Finds and stops the processes a daemon's tests left behind (spec 001 D12).
 * Two kinds are a test's: a process carrying `env`, which only the daemon's
 * Vitest workers get and which nothing else of the daemon runs while no tier
 * does; and a member of the daemon's own process group that no longer
 * descends from the daemon, which only a child whose parent exited is. The
 * group counts only when the daemon leads it (`squeal daemon` spawned
 * detached); a daemon inside another process's group leaves the group alone.
 * What shared the group when the daemon started, such as the rest of a
 * shell pipeline, is never the daemon's, and neither is what it starts.
 * Linux only, through `/proc`; elsewhere nothing is found.
 */
export class EscapedChildren {
  /** What the daemon's Vitest workers add to their env. */
  readonly env: Readonly<Record<string, string>>;
  readonly #needle: string;
  readonly #self: number;
  /** When the daemon started, so the exit looks no further back. */
  readonly #born: number;
  /** The group's other members at the start, by `key`; `null` when the daemon leads no group. */
  readonly #strangers: Promise<ReadonlySet<string> | null>;

  constructor(token: string = randomUUID(), self: number = process.pid) {
    this.env = { [CHILD_VARIABLE]: token };
    this.#needle = `${CHILD_VARIABLE}=${token}\0`;
    this.#self = self;
    this.#born = this.mark();
    this.#strangers = strangersOf(self);
    // Read only through `#find`, which waits for it; a failed scan leaves the group alone.
    this.#strangers.catch(() => {});
  }

  /** The clock `stop` compares start times with: now, a second early, in ticks since boot. */
  mark(): number {
    return Math.max(0, uptimeTicks() - TICKS_PER_SECOND);
  }

  /**
   * After a tier: stops every carrier of `env` started since `since` and every
   * orphan of the daemon's group. Resolves with a note naming them, or `null`.
   */
  async afterTier(since: number): Promise<string | null> {
    const stopped = await this.#stop(since, false);
    return describe(stopped, "a test left running after its tier");
  }

  /**
   * At exit, once the runners closed: every carrier, and every other member
   * of the group, a global setup's child among them.
   */
  async atExit(): Promise<string | null> {
    const stopped = await this.#stop(this.#born, true);
    return describe(stopped, "the runners left running when the daemon exited");
  }

  async #stop(since: number, exiting: boolean): Promise<Stopped[]> {
    if (process.platform !== "linux") return [];
    let entries = await snapshot();
    if (await this.#workersGone(entries, since)) entries = await snapshot();
    const stopped: Stopped[] = [];
    const seen = new Set<number>();
    // A round's kills orphan the children of what it killed, which the next finds in the group.
    for (let round = 0; round < ROUNDS; round++) {
      if (round > 0) entries = await snapshot();
      const found = (await this.#find(entries, since, exiting)).filter(({ pid }) => !seen.has(pid));
      if (found.length === 0) break;
      for (const { pid } of found) seen.add(pid);
      stopped.push(...(await terminate(found)));
    }
    return stopped;
  }

  /**
   * Vitest resolves a run before its workers exit, and they carry `env`: the
   * daemon's own children that do get up to the grace to go first. One still
   * there, such as a thread worker's child, is stopped with the rest.
   * Whether there were any to wait for.
   */
  async #workersGone(entries: readonly ProcessEntry[], since: number): Promise<boolean> {
    const children = entries.filter(({ ppid, start }) => ppid === this.#self && start >= since);
    const carrying = await Promise.all(children.map(({ pid }) => this.#carries(pid)));
    let alive = children.filter((_, i) => carrying[i]);
    if (alive.length === 0) return false;
    const deadline = Date.now() + GRACE_MS;
    while (alive.length > 0 && Date.now() < deadline) {
      await sleep(25);
      alive = survivors(alive);
    }
    return true;
  }

  async #find(
    entries: readonly ProcessEntry[],
    since: number,
    exiting: boolean,
  ): Promise<ProcessEntry[]> {
    const strangers = await this.#strangers.catch(() => null);
    const descendants = descendantsOf([this.#self], entries);
    const foreign = strangers === null ? new Set<number>() : lineOf(strangers, entries);
    const others = entries.filter(({ pid }) => pid !== this.#self);
    const carrying = await Promise.all(
      others.map(({ pid, start }) => (start >= since ? this.#carries(pid) : false)),
    );
    const orphaned = (entry: ProcessEntry) =>
      strangers !== null &&
      entry.pgrp === this.#self &&
      !foreign.has(entry.pid) &&
      (exiting || !descendants.has(entry.pid));
    return others.filter((entry, i) => carrying[i] || orphaned(entry));
  }

  async #carries(pid: number): Promise<boolean> {
    try {
      return `${await readFile(`/proc/${pid}/environ`, "latin1")}\0`.includes(this.#needle);
    } catch {
      // Gone, or another user's.
      return false;
    }
  }
}

/** Stops what each run of `runner` left behind once it settles, before its result is returned. */
export function afterEachRun(
  runner: RunnerAdapter,
  children: EscapedChildren,
  note: (text: string) => void,
): RunnerAdapter {
  return {
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    invalidate: (paths) => runner.invalidate(paths),
    affected: (changedPaths) => runner.affected(changedPaths),
    closure: (testFile) => runner.closure(testFile),
    enumerate: (testFile) => runner.enumerate(testFile),
    testFiles: () => runner.testFiles(),
    environment: () => runner.environment(),
    async run(testFiles, options) {
      const since = children.mark();
      try {
        return await runner.run(testFiles, options);
      } finally {
        const text = await children.afterTier(since).catch(() => null);
        if (text !== null) note(text);
      }
    },
    close: () => runner.close(),
  };
}

/** SIGTERM, up to the grace to go, then SIGKILL. */
async function terminate(found: readonly ProcessEntry[]): Promise<Stopped[]> {
  const named = await Promise.all(
    found.map(async (entry) => ({ pid: entry.pid, args: await args(entry) })),
  );
  for (const { pid } of named) signal(pid, "SIGTERM");
  const deadline = Date.now() + GRACE_MS;
  let alive = survivors(found);
  while (alive.length > 0 && Date.now() < deadline) {
    await sleep(25);
    alive = survivors(alive);
  }
  for (const { pid } of alive) signal(pid, "SIGKILL");
  return named;
}

interface Stopped {
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

async function args(entry: ProcessEntry): Promise<string> {
  try {
    const text = (await readFile(`/proc/${entry.pid}/cmdline`, "utf8"))
      .replaceAll("\0", " ")
      .trim();
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
