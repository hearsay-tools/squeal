import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import type { NodeTestProject, Policy } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore } from "./helpers.js";
import { type TimedRun, timedRunner } from "./timed-runner.js";

/*
 * Task 011-21 slice 2 (spec 011 C4 step 5 as amended for slots): a project
 * of node:test files that sleep, run by the daemon's node:test runner
 * behind the scheduler harness, with a per-user pool of `hostSlots`. Each
 * file's process appends its span, from the process's time origin to its
 * exit, to a log, so a test sees when each process ran, whatever the shape
 * of the runs that held it.
 */
const NT: NodeTestProject = {
  name: "nt",
  cwd: "nt",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

/** One process of a test file: epoch milliseconds from its time origin to its exit. */
export interface Span {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

export interface SlotHarness {
  readonly h: Harness;
  readonly runs: TimedRun[];
  /** The files' spans so far, in start order. */
  spans(): Span[];
  /** The pool's directory, for another daemon's pool. */
  readonly poolDir: string;
  /** Whether the backlog runs in slots from the next selection on (`SlotOptions.slots`). */
  slots(on: boolean): void;
  /** The CPU, in ms, the sink calls' `applyMs` busy-waits have taken so far. */
  applyCpuMs(): number;
}

export interface SlotOptions {
  /** Test file path under `nt/test/` without the suffix, its sleep in ms, and its CPU spin. */
  readonly files: readonly {
    readonly name: string;
    readonly sleepMs: number;
    readonly spinMs?: number;
  }[];
  readonly hostSlots: number;
  readonly tierSize?: number;
  readonly timeoutMs?: number;
  readonly backlogTierSize?: number;
  /** `false` hides `backlogSlot`: the backlog runs in tiers, as before slots. */
  readonly slots?: boolean;
  /**
   * Each sink call that applies results holds the thread this long, as one
   * that lists every known state of a large store does (`mergeApplied`:
   * 55 to 340 ms a call on cezar's).
   */
  readonly applyMs?: number;
  /** Set over the defaults: `RUN_MISSING` for a start that runs its misses (row 011-159). */
  readonly policy?: Partial<Policy>;
}

export const testPath = (name: string) => `nt/test/${name}.test.mjs`;

export async function slotHarness(options: SlotOptions): Promise<SlotHarness> {
  const scratch = mkdtempSync(join(tmpdir(), "squeal-slots-"));
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
  const poolDir = join(scratch, "squeal-uid");
  const log = join(scratch, "spans.jsonl");
  writeFileSync(log, "");
  const repo = createRepo("basic");
  // No Vitest files: the Vitest lane's own backlog tier would share the pool.
  rmSync(join(repo.main, "test"), { recursive: true, force: true });
  mkdirSync(join(repo.main, "nt/test"), { recursive: true });
  for (const { name, sleepMs, spinMs = 0 } of options.files) {
    const path = testPath(name);
    writeFileSync(
      join(repo.main, path),
      [
        'import { appendFileSync } from "node:fs";',
        'import { test } from "node:test";',
        `process.on("exit", () => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ path: ${JSON.stringify(path)}, start: performance.timeOrigin, end: performance.timeOrigin + performance.now() }) + "\\n"));`,
        `test("sleeps", () => { const end = Date.now() + ${spinMs}; while (Date.now() < end); return new Promise((resolve) => setTimeout(resolve, ${sleepMs})); });`,
        "",
      ].join("\n"),
    );
  }
  const store = openRepoStore(repo.commonDir);
  const tierSize = options.tierSize ?? 4;
  const [nodeTest] = createNodeTestRunners([NT], {
    root: repo.main,
    tempDir: join(repo.main, ".."),
    tierSize: () => tierSize,
    note: () => {},
  });
  if (nodeTest === undefined) throw new Error("no node:test runner");
  const mode = { slots: options.slots ?? true };
  const { timed, runs } = timedRunner(nodeTest, () => mode.slots);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize,
    backlogTierSize: options.backlogTierSize ?? 200,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    adapters: [timed],
    capacity: { dir: poolDir, hostSlots: options.hostSlots },
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  });
  const applyMs = options.applyMs ?? 0;
  let applyCpuMs = 0;
  if (applyMs > 0) {
    const apply = h.sink.applyResults.bind(h.sink);
    h.sink.applyResults = (...args) => {
      // A busy host takes the thread from the wait, so it is measured, not taken as `applyMs`.
      const cpu = process.cpuUsage();
      const end = performance.now() + applyMs;
      while (performance.now() < end);
      const used = process.cpuUsage(cpu);
      applyCpuMs += (used.user + used.system) / 1000;
      return apply(...args);
    };
  }
  const spans = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Span)
      .sort((a, b) => a.start - b.start);
  return {
    h,
    runs,
    spans,
    poolDir,
    slots: (on) => {
      mode.slots = on;
    },
    applyCpuMs: () => applyCpuMs,
  };
}

/**
 * List scheduling's makespan of `spans` over `width` workers: each span's
 * duration, in the order they started, on the worker free first.
 */
export function listMakespan(spans: readonly Span[], width: number): number {
  const free = Array.from({ length: width }, () => 0);
  for (const span of spans) {
    const at = Math.min(...free);
    free[free.indexOf(at)] = at + (span.end - span.start);
  }
  return Math.max(...free);
}

/** The most spans running at once. */
export function widest(spans: readonly Span[]): number {
  const edges = spans.flatMap((s) => [
    { at: s.start, d: 1 },
    { at: s.end, d: -1 },
  ]);
  edges.sort((a, b) => a.at - b.at || a.d - b.d);
  let now = 0;
  let most = 0;
  for (const { d } of edges) {
    now += d;
    most = Math.max(most, now);
  }
  return most;
}

/** `pending` of each listed file's key row. */
export function pendingOf(h: Harness, paths: readonly string[]): (string | null | undefined)[] {
  const rows = h.store.testFileKeys.list(h.worktreeId);
  return paths.map((path) => rows.find((r) => r.testFile.path === path)?.pending);
}

/** Whether `path` has a stored PASS from `run`. */
export function storedBy(h: Harness, path: string, run: TimedRun): boolean {
  const key = h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.key;
  return (
    key != null && h.store.results.byKey(key).some((r) => r.provenance.runId === run.options.runId)
  );
}
