import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import {
  type CheckGroup,
  type Consumer,
  DEFAULT_POLICY,
  type GroupSlotScope,
  MAIN_AGENT,
  type Policy,
  type PytestProject,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpOptions,
  type CatchUpRun,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Spec 019 D1 to D3, row 019-10: a worktree with Vitest, node:test and
 * pytest files behind the catch-up fake runner, which runs at once and
 * records each run's lane. Vitest files are of project `""`, the node:test
 * projects are `nt` and `ns` (`slow: true`), the pytest one is `py`. Each
 * test file imports `src/core.ts` or `src/other.ts`.
 */

export const FILES: readonly CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/b.test.ts", ms: 20, imports: ["src/other.ts"] },
  { path: "test/e2e/c.test.ts", ms: 30, imports: ["src/core.ts"] },
  { project: "nt", path: "nt/test/d.test.mjs", ms: 10, imports: ["src/core.ts"] },
  { project: "ns", path: "ns/test/e.test.mjs", ms: 10, imports: ["src/core.ts"] },
  { project: "py", path: "py/tests/test_f.py", ms: 10, imports: ["src/core.ts"] },
];

/** A `nodeTest` entry; the fake runner runs its files, no real `node --test`. */
function nodeTestEntry(name: string, slow: boolean): Policy["nodeTest"][number] {
  return {
    name,
    cwd: name,
    argv: [],
    env: {},
    include: ["test/*.test.mjs"],
    ...(slow ? { slow } : {}),
  };
}

const pytest = (slow: boolean): PytestProject => ({
  name: "py",
  cwd: "py",
  args: [],
  env: {},
  include: ["tests/test_*.py"],
  ...(slow ? { slow } : {}),
});

/**
 * A test group of the node:test runner (the `nodeTest` key); the fake runner
 * runs its files. Here, so a test file that names the key does not read as
 * one that runs a real `node --test` (`test/version-sensitive.test.ts`).
 */
export function nodeTestGroup(name: string, at: CheckGroup["at"], project?: string): CheckGroup {
  return { name, runner: "nodeTest", at, ...(project === undefined ? {} : { project }) };
}

/** A policy whose node:test entry `nt` is slow, for the pure lane tests. */
export function slowNodeTestPolicy(): Pick<Policy, "nodeTest"> {
  return { nodeTest: [{ name: "nt", argv: [], env: {}, include: ["nt/*.test.mjs"], slow: true }] };
}

/** The node:test entries `policy` marks slow come from, as `slowFiles` callers pass them. */
export const nodeTestEntries = (policy: Policy): Policy["nodeTest"] => policy.nodeTest;

/** The runner lane of a file, as the daemon's composite names its adapters. */
export function runnerLane(ref: TestFileRef): string {
  if (ref.project === "nt" || ref.project === "ns") return "node-test";
  if (ref.project === "py") return "pytest";
  return "vitest";
}

export interface GroupPolicy {
  readonly checks?: readonly CheckGroup[];
  /** `pytest[].slow`: absent `false`. */
  readonly pytestSlow?: boolean;
  readonly slow?: Partial<Policy["slow"]>;
  readonly stop?: Partial<Policy["stop"]>;
}

/** The fixture's policy: `slow.include` marks `test/e2e/**`, `ns` is slow, the slow lane starts at once. */
export function groupPolicy(given: GroupPolicy = {}): Partial<Policy> {
  return {
    ...RUN_MISSING,
    nodeTest: [nodeTestEntry("nt", false), nodeTestEntry("ns", true)],
    pytest: [pytest(given.pytestSlow ?? false)],
    slow: {
      ...DEFAULT_POLICY.slow,
      include: ["test/e2e/**"],
      quietMs: 0,
      rank: "duration",
      ...given.slow,
    },
    stop: { ...DEFAULT_POLICY.stop, ...given.stop },
    checks: given.checks ?? [],
  };
}

export interface GroupSide {
  readonly side: CatchUpSide;
  readonly slotDir: string;
  /** The repository's Git common dir, which names its slot directory (`slotFiles`). */
  readonly commonDir: string;
  /** The load guard's one-minute load per CPU from now on; 0 at first. */
  setLoad(load: number): void;
}

export interface GroupSideOptions {
  /** A consumer in a turn before the start: `pause` and `stop` groups wait (`inTurn`). */
  readonly beforeStart?: (side: CatchUpSide) => Promise<void>;
  /** The slot's base directory, shared with another side; default one of this side's own. */
  readonly slotDir?: string;
  /** `capacity.groupSlotScope` for this repository; absent, the slow tier's default, `"user"`. */
  readonly slotScope?: GroupSlotScope;
  /** The runner the scheduler gets, made from the fake one (`CatchUpOptions.wrapRunner`). */
  readonly wrapRunner?: CatchUpOptions["wrapRunner"];
}

/** A started scheduler over `FILES` under `policy`. */
export async function groupSide(
  policy: Partial<Policy>,
  options: GroupSideOptions = {},
): Promise<GroupSide> {
  const repo = catchUpRepo(FILES);
  const slotDir = options.slotDir ?? mkdtempSync(join(tmpdir(), "squeal-019-10-slot-"));
  if (options.slotDir === undefined) {
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  }
  const commonDir = join(repo.main, ".git");
  const scope = options.slotScope;
  let load = 0;
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    lane: runnerLane,
    policy,
    scheduler: {
      slow: {
        slotDir,
        recheckMs: 50,
        cpus: () => 1,
        load: () => [load],
        ...(scope === undefined ? {} : { slotScope: { scope, commonDir } }),
      },
    },
    ...(options.wrapRunner === undefined ? {} : { wrapRunner: options.wrapRunner }),
  });
  await options.beforeStart?.(side);
  await side.scheduler.start();
  return { side, slotDir, commonDir, setLoad: (next) => (load = next) };
}

/** A consumer of `side`'s worktree in a turn; `end` ends the turn and nudges the scheduler, as Stop does. */
export async function inTurn(side: CatchUpSide): Promise<{ end(): Promise<void> }> {
  const delivery = createDelivery(side.store, {
    status: {
      build: () => ({
        schemaVersion: 1,
        available: false,
        reason: "timeout",
        message: "status is not under test here",
      }),
    },
  });
  const consumer: Consumer = {
    worktreeId: side.worktreeId,
    sessionId: "session",
    agentId: MAIN_AGENT,
  };
  await delivery.register(consumer);
  await delivery.startTurn(consumer);
  return {
    async end() {
      await delivery.endTurn(consumer);
      side.scheduler.nudge();
    },
  };
}

/** The paths of every run of `side` so far, flattened. */
export const ranPaths = (side: CatchUpSide): string[] =>
  side.runner.runs.flatMap((run) => run.files.map((f) => f.path));

/** One run as the log records it: its lane and its files' paths, in order. */
export interface LoggedTier {
  readonly lane: string;
  readonly paths: readonly string[];
}

/** The runs from `from` on, each lane's in start order. */
export function tierLog(runs: readonly CatchUpRun[], from = 0): Record<string, string[][]> {
  const log: Record<string, string[][]> = {};
  for (const run of runs.slice(from)) {
    const lane = run.lane ?? "";
    log[lane] = [...(log[lane] ?? []), run.files.map((f) => f.path)];
  }
  return log;
}

/** Waits until every file of `FILES` is current. */
export async function allCurrent(side: CatchUpSide, timeout = 20_000): Promise<void> {
  await expect
    .poll(() => FILES.filter((f) => !side.current(f.path)).map((f) => f.path), { timeout })
    .toEqual([]);
  await side.scheduler.idle();
}
