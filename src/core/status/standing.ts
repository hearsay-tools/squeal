import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/index.js";
import { hostLoad } from "../retry/load.js";
import { claimBoundMs } from "../scheduler/claims.js";
import { promotedIds } from "../scheduler/promotions.js";
import { publishedQuiet } from "../scheduler/quiet.js";
import { runnerPartBoundMs } from "../scheduler/runner-work-bound.js";
import { laneFor, slowView } from "../scheduler/slow.js";
import { publishedYields } from "../scheduler/yields.js";
import { type FileClass, fileClassOf, readHeader } from "../state/index.js";
import type { LoadNow, Standing, TierYield } from "../types/index.js";
import {
  type AbsolutePath,
  type DaemonLiveness,
  type EpochMs,
  isSlowLane,
  type KnownState,
  type Policy,
  type ProjectName,
  type RunRecord,
  type SlowSlotHolders,
  type StatusHeader,
  type StatusHold,
  type Store,
  type TestFileKeyRecord,
  type TestFileRef,
  type UnknownTestFile,
  type WorktreeId,
} from "../types/index.js";
import { readHolds } from "./holds.js";
import { claimantOf, openRunsOf } from "./open-runs.js";
import { slowSlotOf } from "./slot-holders.js";
import { type Facts, once, setupsOf, unknownStanding } from "./standing-facts.js";
import { checksByFile, unknownReasons } from "./unknown-files.js";

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
 * `queued`. A queued one is `promoted` while a named wait's promotion
 * the live daemon published holds it (011-11, 011-13). Row 011-27: a run's
 * and a tier's count of test files, and a running slow file's global setup.
 */
export type PendingReason = Extract<
  Standing,
  { readonly kind: "running" | "queued" | "claim" | "slow" | "unlisted" | "on-hold" }
>;

export interface NamedFile {
  readonly testFile: TestFileRef;
  readonly state: FileClass;
  readonly verdict?: NamedVerdict;
  /** With `pending`. */
  readonly pending?: PendingReason;
  /** With `unknown`: why, as status names it (`unknownReasons`). */
  readonly unknown?: UnknownTestFile;
  /**
   * Row 011-27: where a file without a verdict stands, for its next step
   * (`nextStep`): a `stale` or `unknown` one's other worktree's claim first
   * (design 011-24 section 3, the order rule), else its own state.
   */
  readonly standing?: Standing;
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
  load: () => LoadNow = hostLoad,
): readonly NamedFile[] {
  return standingsOf(store, worktreeId, root, daemon, now, load)(files);
}

/** What a caller already read of the worktree in its read transaction (row 011-29). */
export interface WorktreeReads {
  readonly states: readonly KnownState[];
  readonly keys: readonly TestFileKeyRecord[];
  readonly header: StatusHeader;
  /** The live daemon's open runs, `openRunsOf`'s. */
  readonly runs: readonly RunRecord[];
  /** `slowSlotOf`'s, `null` when it found none; read when a slow file needs it, absent. */
  readonly slowSlot?: SlowSlotHolders | null;
  /** `readHolds`'s; read here when absent (row 011-73). */
  readonly holds?: readonly StatusHold[];
}

/**
 * `readNamedFiles` over any files of the worktree, from one read: status's
 * `Outstanding:` groups pass the rows its snapshot read (`reads`), so no
 * state is decoded twice (row 011-29).
 */
export function standingsOf(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  daemon: DaemonLiveness,
  now: EpochMs,
  load: () => LoadNow = hostLoad,
  reads?: WorktreeReads,
): (files: readonly TestFileRef[]) => readonly NamedFile[] {
  const states = reads?.states ?? store.knownStates.list(worktreeId);
  const keys = reads?.keys ?? store.testFileKeys.list(worktreeId);
  const rows = new Map(keys.map((row) => [testFileId(row.testFile), row]));
  const checks = checksByFile(states);
  const policy = readPolicy(root);
  const runs = reads?.runs ?? openRunsOf(store, worktreeId, daemon);
  const promoted = promotedOf(store, worktreeId, daemon, now);
  const yields = yieldsOf(store, worktreeId, daemon);
  const quiet = quietOf(store, worktreeId, daemon, now);
  const header = reads?.header ?? readHeader(store, worktreeId, states, keys);
  const unlisted = unlistedReason(header, policy);
  const reasons = unknownReasons(store, worktreeId, states, root, now);
  const setups = setupsOf(states);
  const alive = daemon.state === "alive";
  // Row 011-73 (C9, C15): while on hold no tier starts, so a queued file waits for the hold.
  const hold = (reads?.holds ?? readHolds(store, store.worktrees.get(worktreeId), daemon))[0];
  const slot = once(() =>
    reads?.slowSlot === undefined
      ? slowSlotOf(store, worktreeId, root, header, alive, now)
      : (reads.slowSlot ?? undefined),
  );
  const facts: Facts = {
    lookupOnly: policy.baseline.onStart === "lookup-only",
    installCommand: header.installCommand ?? null,
    load: once(load),
    // What `run --all --wait` runs, from the rows and states read above: no further read.
    notCurrent: once(
      () =>
        keys.filter(
          (row) => fileClassOf(row, checks.get(testFileId(row.testFile)) ?? []) !== "current",
        ).length,
    ),
  };
  return (files) =>
    files.map((ref): NamedFile => {
      const row = rows.get(testFileId(ref));
      const own = checks.get(testFileId(ref)) ?? [];
      const state = fileClassOf(row, own);
      if (state === "current") return { testFile: ref, state, ...verdictOf(own) };
      // The order rule (design 011-24 section 3): a run of its key elsewhere is waited for, not retried.
      const key = row?.key ?? null;
      const claimant =
        state === "pending" || key === null ? null : claimantOf(store, worktreeId, ref, key, now);
      const claim: Standing | null =
        claimant === null
          ? null
          : { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
      if (state === "stale") {
        const verdict = verdictOf(own);
        const standing: Standing = claim ?? {
          kind: "stale",
          verdict: verdict.verdict ?? null,
          lookupOnly: facts.lookupOnly,
          notCurrent: facts.notCurrent(),
        };
        return { testFile: ref, state, ...verdict, standing };
      }
      if (state === "unknown") {
        if (row === undefined) return { testFile: ref, state };
        const unknown = reasons.of(row, own);
        return {
          testFile: ref,
          state,
          unknown,
          standing: claim ?? unknownStanding(unknown, facts),
        };
      }
      const running = row?.pending === "running" || own.some((s) => s.pendingPhase === "running");
      const lane = laneFor(policy, ref, runnerLaneOf(policy, ref.project));
      const run = running ? runOf(runs, ref) : undefined;
      const setup = isSlowLane(lane) ? setups.get(ref.project) : undefined;
      const pending: PendingReason = running
        ? {
            kind: "running",
            lane,
            since: run?.startedAt ?? null,
            ...(run === undefined ? {} : { files: run.testFiles.length }),
            ...(setup === undefined ? {} : { setup }),
          }
        : (unlisted ?? queuedReason(store, worktreeId, ref, key, lane, runs, policy, now));
      if (hold !== undefined && (pending.kind === "queued" || pending.kind === "slow")) {
        const held: PendingReason = { kind: "on-hold", hold };
        return { testFile: ref, state, pending: held, standing: held };
      }
      // Row 011-82: no tier runs in its lane, which waits for quiet; the wait holds no promoted file.
      const quietUntil = pending.kind === "queued" ? quiet.get(pending.lane) : undefined;
      if (pending.kind === "queued" && pending.behind === null && quietUntil !== undefined) {
        if (!promoted.has(testFileId(ref))) {
          const held: PendingReason = { ...pending, quietUntil };
          return { testFile: ref, state, pending: held, standing: held };
        }
      }
      if (pending.kind === "queued" && promoted.has(testFileId(ref))) {
        // Row 011-51: whether the tier it is queued behind yields to it, as the daemon published.
        const tier = pending.behind === null ? undefined : yieldIn(runs, lane, policy, yields);
        const promotedReason: PendingReason = {
          ...pending,
          promoted: true,
          ...(tier === undefined ? {} : { yields: tier }),
        };
        return { testFile: ref, state, pending: promotedReason, standing: promotedReason };
      }
      if (pending.kind === "slow") {
        // Row 011-58 (gh-58): while the daemon waits for the slot, who holds it.
        const held = slot();
        if (held !== undefined) {
          const waiting: PendingReason = { ...pending, slot: held };
          return { testFile: ref, state, pending: waiting, standing: waiting };
        }
      }
      if (pending.kind === "unlisted" && promoted.has(testFileId(ref))) {
        // C15: "; the run yields" when the run the runner part waits for is cancelled for it.
        const run = yieldIn(runs, lane, policy, yields);
        if (run?.kind === "yields") {
          const yielding: PendingReason = { ...pending, yields: run };
          return { testFile: ref, state, pending: yielding, standing: yielding };
        }
      }
      return { testFile: ref, state, pending, standing: pending };
    });
}

/**
 * A claim's bound: the waiter's runs from when its daemon first saw the
 * claim, which only that daemon knows and is no later than now, so now plus
 * the bound is a true "at most". The claimant's run start says nothing: its
 * own policy, not this one, bounds its run (review wave-1.11 B1, re-review).
 */
function claimBound(policy: Policy, now: EpochMs): EpochMs {
  return now + claimBoundMs(policy.runner.timeoutMs);
}

/**
 * Task 004-78 (research `atomic-flags-0215.md` 4, item 1): the ids of
 * `files` that run only on a pause, each a slow file still queued with
 * nothing holding it but the slow tier's turn (`queuedReason`'s `slow`): no
 * run of its own, none in its lane, no other worktree's claim. A named wait
 * leaves them out of what it holds for, since nothing runs them inside the
 * agent's turn but `run --slow` (004 D2, D9). Only under `slow.trigger:
 * "idle"`: a continuous lane runs them in the turn once the revision is
 * `slow.quietMs` old, so the wait holds for them as for any file (004-80).
 */
export function pauseOnlyIds(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  files: readonly TestFileRef[],
  daemon: DaemonLiveness,
  now: EpochMs,
): ReadonlySet<string> {
  const policy = readPolicy(root);
  if (policy.slow.trigger !== "idle") return new Set();
  const slow = files.filter((ref) => slowView(policy).isSlow(ref));
  if (slow.length === 0) return new Set();
  const rows = new Map(
    store.testFileKeys.list(worktreeId, slow).map((row) => [testFileId(row.testFile), row]),
  );
  // Task 011-42: a named wait calls this on each poll; it reads the slow files' states only.
  const checks = checksByFile(store.knownStates.list(worktreeId, slow));
  const runs = openRunsOf(store, worktreeId, daemon);
  const ids = new Set<string>();
  for (const ref of slow) {
    const id = testFileId(ref);
    const row = rows.get(id);
    const own = checks.get(id) ?? [];
    if (fileClassOf(row, own) !== "pending") continue;
    if (row?.pending === "running" || own.some((s) => s.pendingPhase === "running")) continue;
    const lane = laneFor(policy, ref, runnerLaneOf(policy, ref.project));
    const reason = queuedReason(store, worktreeId, ref, row?.key ?? null, lane, runs, policy, now);
    if (reason.kind === "slow") ids.add(id);
  }
  return ids;
}

/** What the live daemon published as promoted now (`promotedIds`); nothing without one. */
function promotedOf(
  store: Store,
  worktreeId: WorktreeId,
  daemon: DaemonLiveness,
  now: EpochMs,
): ReadonlySet<string> {
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null || daemon.state !== "alive") return new Set();
  return promotedIds(store, worktreeId, record.startedAt, now);
}

/**
 * What the live daemon published of its tiers in flight (`publishedYields`,
 * row 011-51); nothing without one, or from an older daemon.
 */
function yieldsOf(
  store: Store,
  worktreeId: WorktreeId,
  daemon: DaemonLiveness,
): ReadonlyMap<string, TierYield> {
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null || daemon.state !== "alive") return new Map();
  return publishedYields(store, worktreeId, record.startedAt);
}

/**
 * When each lane's wait for quiet ends, as the live daemon published it
 * (`publishedQuiet`, row 011-82); none without one, or from an older daemon.
 */
function quietOf(
  store: Store,
  worktreeId: WorktreeId,
  daemon: DaemonLiveness,
  now: EpochMs,
): ReadonlyMap<string, EpochMs> {
  const record = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (record === null || daemon.state !== "alive") return new Map();
  return publishedQuiet(store, worktreeId, record.startedAt, now);
}

/** Whether the open run of `lane` yields, as `yields` holds it; `undefined` when not known. */
function yieldIn(
  runs: readonly RunRecord[],
  lane: string,
  policy: Policy,
  yields: ReadonlyMap<string, TierYield>,
): TierYield | undefined {
  const run = runIn(runs, lane, policy);
  return run === undefined ? undefined : yields.get(run.id);
}

/** The open run of `lane`, a tier holding one file of it. */
function runIn(runs: readonly RunRecord[], lane: string, policy: Policy): RunRecord | undefined {
  return runs.find((run) =>
    run.testFiles.some((f) => laneFor(policy, f, runnerLaneOf(policy, f.project)) === lane),
  );
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
    return { kind: "claim", worktree: claimant.worktree.root, until: claimBound(policy, now) };
  }
  const tier = runIn(runs, lane, policy);
  if (tier !== undefined) {
    return { kind: "queued", lane, behind: tier.startedAt, files: tier.testFiles.length };
  }
  if (slowView(policy).isSlow(ref)) {
    return policy.slow.trigger === "idle" ? { kind: "slow", pausesOnly: true } : { kind: "slow" };
  }
  return { kind: "queued", lane, behind: null };
}

/**
 * While the runner part of the revision is pending no tier starts (C4): the
 * revision and the bound on each of its runner calls, `runnerPartBoundMs`;
 * `null` when it is listed.
 */
function unlistedReason(
  header: ReturnType<typeof readHeader>,
  policy: Policy,
): PendingReason | null {
  const refined = header.refinedRevision;
  if (header.runnerPartPending !== true || refined === null || refined === undefined) return null;
  // C4's bound is per runner call (an invalidate, then an affected call, each its own),
  // and the store keeps no call's start: the bound is said per call, never as a
  // countdown from the revision's age (review wave-1.11 B3).
  const callBoundMs = runnerPartBoundMs(policy.runner.timeoutMs);
  return { kind: "unlisted", revision: header.revision, callBoundMs };
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
