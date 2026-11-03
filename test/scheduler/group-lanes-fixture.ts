import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import {
  type CheckGroup,
  DEFAULT_POLICY,
  type Policy,
  type PytestProject,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
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
}

/** A started scheduler over `FILES` under `policy`. */
export async function groupSide(policy: Partial<Policy>): Promise<GroupSide> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-019-10-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 8,
    lane: runnerLane,
    policy,
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
  });
  await side.scheduler.start();
  return { side, slotDir };
}

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
