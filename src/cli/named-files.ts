import { readPolicy } from "../core/daemon/policy.js";
import { testFileId } from "../core/keys/index.js";
import { claimBoundMs } from "../core/scheduler/claims.js";
import { runnerPartBoundMs } from "../core/scheduler/runner-work-bound.js";
import { laneFor, slowView } from "../core/scheduler/slow.js";
import { readHeader } from "../core/state/index.js";
import { checksByFile, claimantOf, openRunsOf, unknownReasons } from "../core/status/index.js";
import type {
  AbsolutePath,
  DaemonLiveness,
  EpochMs,
  KnownState,
  Policy,
  ProjectName,
  RunRecord,
  Store,
  TestFileRef,
  UnknownTestFile,
  WorktreeId,
} from "../core/types/index.js";
import { type FileClass, fileClassOf } from "./verdict.js";

/*
 * Task 011-12 (011 C15, issues 17, 23, 24): what a named wait says of each
 * selected test file, its class and verdict, and for one still pending the
 * one thing that holds it, with its bound when the store knows one.
 */

/** A selected file's outcome, when it is `current` or `stale` (the last one stored). */
export type NamedVerdict = "pass" | "fail" | "skip";

/**
 * What holds a pending selected file (011 C15): its own run in its lane; the
 * tier running in its lane; another worktree's run of its key (C7); the slow
 * tier's turn (004 D2); the revision's runner part (C4); or nothing known,
 * `queued`. 011-11's promotion is not read here: the word is `queued`.
 */
export type PendingReason =
  | { readonly kind: "running"; readonly lane: string; readonly since: EpochMs | null }
  | { readonly kind: "queued"; readonly lane: string; readonly behind: EpochMs | null }
  | { readonly kind: "claim"; readonly worktree: string; readonly until: EpochMs | null }
  | { readonly kind: "slow" }
  | { readonly kind: "unlisted"; readonly revision: number; readonly leftMs: number };

export interface NamedFile {
  readonly testFile: TestFileRef;
  readonly state: FileClass;
  readonly verdict?: NamedVerdict;
  /** With `pending`. */
  readonly pending?: PendingReason;
  /** With `unknown`: why, as status names it (`unknownReasons`). */
  readonly unknown?: UnknownTestFile;
}

/**
 * Each of `files`, in their order, from one read of the store: the class
 * `readVerdict` counts it in, its verdict, and why it is pending or
 * `unknown`. `daemon` is the snapshot's liveness: only a live daemon's open
 * runs hold a file.
 */
export function readNamedFiles(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  files: readonly TestFileRef[],
  daemon: DaemonLiveness,
  now: EpochMs,
): readonly NamedFile[] {
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const checks = checksByFile(states);
  const policy = readPolicy(root);
  const runs = openRunsOf(store, worktreeId, daemon);
  const header = readHeader(store, worktreeId, states, keys);
  const unlisted = unlistedReason(header, policy);
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  return files.map((ref): NamedFile => {
    const row = rows.get(testFileId(ref));
    const own = checks.get(testFileId(ref)) ?? [];
    const state = fileClassOf(row, own);
    if (state === "current" || state === "stale")
      return { testFile: ref, state, ...verdictOf(own) };
    if (state === "unknown") {
      return row === undefined
        ? { testFile: ref, state }
        : { testFile: ref, state, unknown: reasons.of(row, own) };
    }
    const running = row?.pending === "running" || own.some((s) => s.pendingPhase === "running");
    const lane = laneFor(policy, ref, runnerLaneOf(policy, ref.project));
    const pending: PendingReason = running
      ? { kind: "running", lane, since: runOf(runs, ref)?.startedAt ?? null }
      : (unlisted ??
        queuedReason(store, worktreeId, ref, row?.key ?? null, lane, runs, policy, now));
    return { testFile: ref, state, pending };
  });
}

/**
 * The lane the daemon's composite runner gives `project` (`RunnerAdapter.lane`
 * is its owner's name): a configured node:test or pytest project's, else
 * Vitest's. Learned at run time by the daemon; the policy names the same.
 */
function runnerLaneOf(policy: Policy, project: ProjectName): string {
  if (policy.nodeTest.some((p) => p.name === project)) return "node-test";
  if (policy.pytest.some((p) => p.name === project)) return "pytest";
  return "vitest";
}

/** Why a file not running is still queued, past the runner part (`readNamedFiles`). */
function queuedReason(
  store: Store,
  worktreeId: WorktreeId,
  ref: TestFileRef,
  key: string | null,
  lane: string,
  runs: readonly RunRecord[],
  policy: Policy,
  now: EpochMs,
): PendingReason {
  const claimant = key === null ? null : claimantOf(store, worktreeId, ref, key, now);
  if (claimant !== null) {
    // The waiter's bound runs from when its daemon first saw the claim, which only that
    // daemon knows, and is no later than now; a bounded claimant's run also ends by its
    // start plus the bound. The earlier is a true "at most" (review wave-1.11 B1).
    const bound = claimBoundMs(policy.runner.timeoutMs);
    const waiter = now + bound;
    const until =
      claimant.run === null || policy.runner.timeoutMs === null
        ? waiter
        : Math.min(waiter, claimant.run.startedAt + bound);
    return { kind: "claim", worktree: claimant.worktree.root, until };
  }
  const tier = runs.find((run) =>
    run.testFiles.some((f) => laneFor(policy, f, runnerLaneOf(policy, f.project)) === lane),
  );
  if (tier !== undefined) return { kind: "queued", lane, behind: tier.startedAt };
  if (slowView(policy).isSlow(ref)) return { kind: "slow" };
  return { kind: "queued", lane, behind: null };
}

/**
 * While the runner part of the revision is pending no tier starts (C4): the
 * revision and how long its call may still take, at most one call's
 * `runnerPartBoundMs`; `null` when it is listed.
 */
function unlistedReason(
  header: ReturnType<typeof readHeader>,
  policy: Policy,
): PendingReason | null {
  const refined = header.refinedRevision;
  if (header.runnerPartPending !== true || refined === null || refined === undefined) return null;
  // C4's bound is per runner call, and the store keeps no call's start, so the
  // revision's age says nothing of it: the whole bound is what may be left (review wave-1.11 B3).
  const leftMs = runnerPartBoundMs(policy.runner.timeoutMs);
  return { kind: "unlisted", revision: header.revision, leftMs };
}

function runOf(runs: readonly RunRecord[], ref: TestFileRef): RunRecord | undefined {
  const id = testFileId(ref);
  return runs.find((run) => run.testFiles.some((f) => testFileId(f) === id));
}

/** `fail` with a failing check, else `pass` with a passing one, else `skip` with a skipped one. */
function verdictOf(own: readonly KnownState[]): { verdict?: NamedVerdict } {
  for (const verdict of ["fail", "pass", "skip"] as const) {
    if (own.some((s) => s.outcome === verdict)) return { verdict };
  }
  return {};
}
