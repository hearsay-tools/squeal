import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunnerAdapter, RunOptions } from "../types/runner.js";
import { CHILD_VARIABLE, type RunNote } from "./escaped.js";
import { type GroupRecord, type RecordedGroup, STOPPED_WHAT, stopGroups } from "./run-groups.js";
import {
  childrenOf,
  describe,
  type ProcessEntry,
  statOf,
  TICKS_PER_SECOND,
  uptimeTicks,
} from "./terminate.js";

/*
 * Spec 023 D4 step 11 (row 023-36, T3): while a run for a `--run` request
 * lasts, the daemon's process tree is walked every `EVERY_MS`. A process
 * that leads a group of its own, started since the run began, whose parent
 * or an ancestor carries the run's mark (the run's workers and what they
 * started with their env), is the run's: its group is recorded
 * (`GroupRecord`) and stopped when the run settles. Its own env does not
 * count, so a test's process that cleared it is found while its starter
 * lives. A runner's own test process, which leads a group as node:test's
 * does, has a parent with no mark and is not recorded. Linux only.
 */

/** How often the tree is walked while a flagged run lasts. */
const EVERY_MS = 100;
/** How long the paths of a `--run` request mark the runs of their files, unless one ran them. */
export const AT_RUN_TTL_MS = 60 * 60 * 1_000;

/**
 * The paths `--run` requests asked the daemon to run (`run-group-paths`
 * with `at`): a run of any of them is flagged. A flagged run's paths are
 * dropped when it settles; others after `AT_RUN_TTL_MS`.
 */
export class AtRunPaths {
  readonly #until = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  add(paths: readonly RelativePath[]): void {
    const until = this.#now() + AT_RUN_TTL_MS;
    for (const path of paths) this.#until.set(path, until);
  }

  flagged(testFiles: readonly TestFileRef[]): boolean {
    const now = this.#now();
    for (const [path, until] of this.#until) if (until <= now) this.#until.delete(path);
    return testFiles.some(({ path }) => this.#until.has(path));
  }

  ran(testFiles: readonly TestFileRef[]): void {
    for (const { path } of testFiles) this.#until.delete(path);
  }
}

export interface RunGroupsOptions {
  readonly paths: Pick<AtRunPaths, "flagged" | "ran">;
  readonly record: Pick<GroupRecord, "add" | "remove">;
  readonly note: (note: RunNote) => void;
  /** The process whose tree is walked: the daemon. */
  readonly self?: number;
  /** Stops the found groups; `stopGroups` but in a test. */
  readonly stop?: typeof stopGroups;
}

/**
 * `runner` with the groups each flagged run started stopped when it
 * settles, before its report is returned, and named in a note. Sits inside
 * `afterEachRun`, which puts the run's mark in `RunOptions.childEnv`.
 */
export function withRunGroups(runner: RunnerAdapter, options: RunGroupsOptions): RunnerAdapter {
  const self = options.self ?? process.pid;
  const stop = options.stop ?? stopGroups;
  const releaseLane = runner.releaseLane?.bind(runner);
  const recheck = runner.recheck?.bind(runner);
  const globalSetups = runner.globalSetups?.bind(runner);
  return {
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    traits: runner.traits,
    invalidate: (paths) => runner.invalidate(paths),
    ...(recheck === undefined ? {} : { recheck }),
    affected: (changedPaths) => runner.affected(changedPaths),
    closure: (testFile) => runner.closure(testFile),
    enumerate: (testFile) => runner.enumerate(testFile),
    testFiles: () => runner.testFiles(),
    ...(globalSetups === undefined ? {} : { globalSetups }),
    environment: () => runner.environment(),
    ...(releaseLane === undefined ? {} : { releaseLane }),
    async run(testFiles, runOptions) {
      const mark = runOptions.childEnv?.[CHILD_VARIABLE];
      if (process.platform !== "linux" || mark === undefined || !options.paths.flagged(testFiles))
        return runner.run(testFiles, runOptions);
      const watch = new GroupWatch(self, mark, runOptions, options.record);
      const settled = new AbortController();
      const looking = watch.every(settled.signal);
      try {
        return await runner.run(testFiles, runOptions);
      } finally {
        settled.abort();
        await looking;
        watch.look();
        options.paths.ran(testFiles);
        const found = watch.found();
        const stopped = await stop(found);
        options.record.remove(found);
        const note = describe(stopped, STOPPED_WHAT);
        if (note !== null) options.note(note);
      }
    },
    close: () => runner.close(),
  };
}

/** One flagged run's walks of the daemon's tree. */
class GroupWatch {
  readonly #self: number;
  readonly #mark: string;
  readonly #runId: string;
  readonly #since: number;
  readonly #record: Pick<GroupRecord, "add">;
  /** Whether a process carries the mark, by `<pid>:<start>`, once it is old enough to keep. */
  readonly #carries = new Map<string, boolean>();
  readonly #found = new Map<string, RecordedGroup>();

  constructor(self: number, mark: string, options: RunOptions, record: Pick<GroupRecord, "add">) {
    this.#self = self;
    this.#mark = mark;
    this.#runId = options.runId;
    this.#since = Math.max(0, uptimeTicks() - TICKS_PER_SECOND);
    this.#record = record;
  }

  found(): RecordedGroup[] {
    return [...this.#found.values()];
  }

  async every(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await sleep(EVERY_MS, undefined, { signal });
      } catch {
        return;
      }
      this.look();
    }
  }

  /** One walk; never throws. */
  look(): void {
    try {
      // Read again until 100 ms old: before its exec, a child shows its parent's environ.
      const settled = uptimeTicks() - TICKS_PER_SECOND / 10;
      const queue: { pid: number; under: boolean }[] = childrenOf(this.#self).map((pid) => ({
        pid,
        under: false,
      }));
      const visited = new Set<number>();
      for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
        if (visited.has(next.pid)) continue;
        visited.add(next.pid);
        const entry = statOf(next.pid);
        if (entry === null) continue;
        if (next.under && entry.pgrp === entry.pid && entry.start >= this.#since) this.#keep(entry);
        const under = next.under || this.#carriesMark(entry, settled);
        for (const pid of childrenOf(entry.pid)) queue.push({ pid, under });
      }
    } catch {
      // The next look tries again.
    }
  }

  #keep(entry: ProcessEntry): void {
    const id = `${entry.pid}:${entry.start}`;
    if (this.#found.has(id)) return;
    const group = { pgid: entry.pid, start: entry.start, runId: this.#runId };
    this.#found.set(id, group);
    this.#record.add(group);
  }

  #carriesMark(entry: ProcessEntry, settled: number): boolean {
    const id = `${entry.pid}:${entry.start}`;
    const known = this.#carries.get(id);
    if (known !== undefined) return known;
    const carries = environHas(entry.pid, `${CHILD_VARIABLE}=${this.#mark}`);
    if (entry.start < settled) this.#carries.set(id, carries);
    return carries;
  }
}

/** Whether `pid`'s environ holds exactly `entry`; `false` when it cannot be read. */
function environHas(pid: number, entry: string): boolean {
  try {
    return `\0${readFileSync(`/proc/${pid}/environ`, "latin1")}\0`.includes(`\0${entry}\0`);
  } catch {
    return false;
  }
}
