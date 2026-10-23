import { randomUUID } from "node:crypto";
import { testFileId } from "../keys/index.js";
import {
  type CheckId,
  type RelativePath,
  type ResultRecord,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../types/index.js";
import { owedStrict, resumeOwed } from "./checkpoint-requests.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { cutAtStart } from "./edit-cut.js";
import { block, type Failures } from "./failures.js";
import { durationOf, type FileState } from "./files.js";
import { handover } from "./handover.js";
import { takeHeldFiles } from "./held.js";
import type { Ledger } from "./ledger.js";
import { persistedNoteTexts, unmatchedInputNotes } from "./notes.js";
import { listTestFilesOf } from "./omitted-test-files.js";
import { priorityOf } from "./queue.js";
import { restoreReruns } from "./rerun.js";
import { isCatchUp, readEnvironments, resolveClosures } from "./revision.js";
import { runnerPartBound } from "./runner-work-bound.js";

/**
 * Daemon start in a worktree: `scan`, then `baseline`, at once or, while no
 * dependencies are installed, at the install (task 001-100).
 *
 * Spec 001 D5: "On daemon start in a worktree, the baseline is a lookup (step
 * 3 for all test files) followed by a run of the misses, or lookup only, per
 * policy." ADR 0002: "compute keys from stored closure lists, look them up."
 *
 * 1. The stat cache: cached paths reconciled, other git-known files hashed.
 * 2. Environments, then every test file keyed from the stored closure list
 *    plus this worktree's declared inputs (review B1 scenario 3), or from the
 *    runner when no list is stored. Untracked closure paths are hashed first.
 * 3. Lookup. A hit is safe with another worktree's closure list: equal
 *    contents import the same files (B1). A miss will run, so it is keyed
 *    again from this worktree's own closure and looked up once more.
 * 4. One checkpoint of kind `baseline` over the misses and the unkeyed
 *    files, run in tiers or, with `baseline.onStart: "lookup-only"`,
 *    abandoned unless empty. An unkeyed file ends it `abandoned` (D5).
 *    Whatever the policy, a miss whose row the last daemon left `queued` or
 *    `running` is queued, in the group its open re-key moves give it, and a
 *    pending re-run too (`handover`, 011 C4 as amended 2026-10-20, 011-33).
 *
 * What the last daemon of this worktree knew comes back from the store:
 * known checks and failures from `known_states`, the previous key from
 * `test_file_keys`. Test files that are gone from a successful listing are
 * forgotten and their checks retired. A failed listing keeps the previous
 * list; a failed environment or closure call blocks the project's files
 * (D5: "A runner call that fails is a state, never a skip").
 *
 * The baseline is the runner part of the revision it starts at, so its
 * commit records that revision as refined (D2 as amended). Policy `inputs`
 * entries that select nothing get a note each, unless an earlier start
 * persisted the same one (review wave 4.5, S5). Its runner calls are bounded
 * as a refinement's are (`RunnerPartBound`, task 001-259): it holds the
 * lock, at start or at the install that ends a wait, so a wedged runner
 * past the bound is noted and fails the calls, and the baseline commits.
 *
 * `scan` is step 1, which needs no runner: the `start` revision and the
 * revision the ledger starts at. It returns the paths no runner has seen
 * change, one set per revision: those of the `start` revision and of every
 * revision after the refined one (`refinedMetaKey`), which an earlier daemon
 * stored and never refined, as one that exited at a reinstall did (task
 * 001-113). The baseline queues them as edits (D5 step 4). A start that
 * resumes a rest counts the paths it hashed for the first time as its
 * `start` revision's (011 C9 as amended 2026-10-21, row 011-91).
 */
export async function scan(
  context: SchedulerContext,
  ledger: Ledger,
  resumesRest = false,
): Promise<UnseenChanges> {
  const { store, keys, worktreeId } = context;
  const latest = store.revisions.latest(worktreeId);
  const refined = readRefined(store, worktreeId) ?? latest?.number ?? 0;
  const started = await keys.bootstrap(context.head);
  const revision = started ?? latest;
  ledger.revision =
    revision === null
      ? { number: 0, ...(await context.head()) }
      : { number: revision.number, head: revision.head, dirty: revision.dirty };
  const unseen =
    revision === null
      ? []
      : store.revisions
          .range(worktreeId, refined, revision.number)
          .map(({ changes }) => new Set(changes.map((change) => change.path)));
  if (!resumesRest || keys.seededAtStart.length === 0) return unseen;
  // The start revision is the last of the range; with none, the new files are one of their own.
  const startPaths = started === null ? [] : [...(unseen.pop() ?? [])];
  return [...unseen, new Set([...startPaths, ...keys.seededAtStart])];
}

/** `null` when absent or not a number, as the header reads it. */
function readRefined(store: Store, worktreeId: WorktreeId): RevisionNumber | null {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}

/**
 * Steps 2 to 4: environments, listing, keys, lookup and the baseline
 * checkpoint. `unseen` holds the paths no runner saw change, by revision:
 * those `scan` returned and those revisions changed while the daemon waited
 * for an install. A miss they edited or whose closure they touch is queued
 * recent, ahead of the rest (review wave 11, S2; D5 step 4), or as catch-up
 * when every revision that reached it holds 10 keyed paths or more
 * (`isCatchUp`, 011 C4 step 4 as amended 2026-10-20, task 011-22): each
 * revision is counted on its own, never their union (review wave 5, B3).
 * Of a smaller revision's reach, what the edit cut does not keep is
 * catch-up, by the runner's `affected` for its paths (`cutAtStart`, task
 * 011-25). Under `lookup-only` only a start that resumes a rest queues
 * that reach (011 C9 as amended 2026-10-21, row 011-91).
 */
export async function baseline(
  context: SchedulerContext,
  ledger: Ledger,
  unseen: UnseenChanges = [],
  resumesRest = false,
): Promise<void> {
  const { store, keys, worktreeId, policy } = context;
  const bound = runnerPartBound(context);
  const failures: Failures = new Map();
  // The lookup below finds a file a heal left held as a miss (review wave 13i, B1).
  takeHeldFiles(store, worktreeId);
  await readEnvironments(context, failures, bound);
  const listed = await tryRunner(context, "testFiles", () => listTestFilesOf(context, bound));
  ledger.listingFailed = listed === null;
  const previousKeys = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row]),
  );
  const refs = listed ?? [...previousKeys.values()].map((row) => row.testFile);
  const known = knownChecks(context, ledger);
  const fromStore = new Set<string>();
  const unresolved: TestFileRef[] = [];
  for (const ref of refs) {
    const file = ledger.addFile(ref);
    restore(file, known.get(file.id));
    const record = store.testFiles.get(ref);
    if (record !== null) {
      keys.setClosure({ testFile: ref, paths: record.closure.paths });
      fromStore.add(file.id);
    } else {
      unresolved.push(ref);
    }
  }
  await resolveClosures(context, unresolved, failures, bound);
  if (listed !== null) {
    for (const row of previousKeys.values()) {
      if (ledger.file(row.testFile)) continue;
      const gone = ledger.addFile(row.testFile);
      restore(gone, known.get(gone.id));
      ledger.removeFile(gone);
    }
  }

  const checkpointId = randomUUID();
  const lookup = (files: Iterable<TestFileRef>) =>
    ledger.settle(files, NOTHING_CHANGED, { checkpointId, queueMisses: false });
  const first = lookup(refs);
  const recheck = first.filter((file) => fromStore.has(file.id));
  await resolveClosures(
    context,
    recheck.map((file) => file.ref),
    failures,
    bound,
  );
  const misses = [
    ...first.filter((file) => !fromStore.has(file.id)),
    ...lookup(recheck.map((file) => file.ref)),
  ];

  for (const file of misses) {
    const previous = previousKeys.get(file.id)?.key ?? null;
    // `usedAt` 0 never advances last-used: reading a duration is not a lookup hit (D8).
    const results = previous === null ? [] : store.results.byKey(previous, 0);
    if (results.length === 0) {
      // No previous key, as at a new worktree's first start (row 011-154), or one stored at a
      // revision the last daemon never ran (task 004-54): no held fail, only a duration.
      file.durationMs = durationOf(newestResults(store, file.ref));
      continue;
    }
    // A miss at its previous key is a held inherited fail (task 001-170): no result stands here yet.
    if (previous !== file.key) file.resultKey = previous;
    file.durationMs = durationOf(results);
  }
  const unkeyed = [...ledger.files.values()].filter((file) => file.key === null);
  const owed = ledger.checkpoints.takeOwed();
  const forced = outside(owedStrict(ledger, owed), [...misses, ...unkeyed]);
  ledger.checkpoints.start(
    checkpointId,
    "baseline",
    ledger.revision.number,
    [...misses, ...unkeyed, ...forced].map((file) => file.ref),
  );
  const lookupOnly = policy.baseline.onStart === "lookup-only";
  if (lookupOnly) ledger.checkpoints.finish("abandoned");
  // Only a predecessor's queued work runs, unless the start resumes a rest (011-33, 011-91).
  const holds = lookupOnly && !resumesRest;
  const handed = handover(context, ledger, previousKeys);
  // What no runner saw change is its revision's edit here, catch-up from 10 keyed paths (011-22).
  const changed = new Set([...unseen.flatMap((paths) => [...paths]), ...handed.changed]);
  const recent = new Set(handed.first);
  const catchUp = new Set(handed.catchUp);
  const direct = new Set<string>();
  const missed = new Set(misses.map((file) => file.id));
  for (const paths of unseen) {
    const large = isCatchUp(context, ledger, paths);
    const reached = ledger.recentOf(paths);
    // A small revision keeps its namesakes and the shortest direct importers (011-25): the
    // runner is asked only when the revision reached a file that runs, so never while
    // lookup-only holds.
    const cut =
      holds || large || ![...reached].some((id) => missed.has(id))
        ? null
        : await cutAtStart(context, ledger, paths, bound);
    for (const id of cut?.direct ?? []) direct.add(id);
    for (const id of cut?.reached ?? reached) {
      const kept = !large && (cut === null || cut.kept === null || cut.kept.has(id));
      (kept ? recent : catchUp).add(id);
    }
  }
  for (const file of misses) {
    // A predecessor's queued work is handed over whatever the policy (011 C4, task 011-33);
    // a resumed rest's reach too (011 C9, row 011-91).
    const reached = resumesRest && (recent.has(file.id) || catchUp.has(file.id));
    if (lookupOnly && !handed.pending.has(file.id) && !reached) continue;
    const first = recent.has(file.id);
    const priority = priorityOf(file, changed, direct);
    ledger.enqueue(file, priority, false, first, !first && catchUp.has(file.id));
  }
  restoreReruns(context, ledger);
  for (const file of unkeyed) ledger.checkpoints.failed(file.ref);
  resumeOwed(ledger, owed);
  if (failures.size > 0) block(ledger, failures);
  ledger.commit({ refined: ledger.revision.number });
  const persisted = persistedNoteTexts(store, worktreeId);
  const testFiles = testFilePaths(ledger);
  for (const text of unmatchedInputNotes(keys.unmatchedInputs(testFiles), testFiles.length)) {
    if (!persisted.has(text)) context.note(text);
  }
}

/** `files` without those in `others`. */
function outside(files: readonly FileState[], others: readonly FileState[]): FileState[] {
  const elsewhere = new Set(others.map((file) => file.id));
  return files.filter((file) => !elsewhere.has(file.id));
}

/**
 * A test file's results under the key of its newest result, from any
 * worktree; empty when it has none. Read only: never advances last-used.
 */
function newestResults(store: Store, ref: TestFileRef): readonly ResultRecord[] {
  let newest: ResultRecord | null = null;
  for (const { check } of store.checks.listByTestFile(ref)) {
    const result = store.results.latestForCheck(check);
    if (
      result !== null &&
      (newest === null || result.provenance.recordedAt > newest.provenance.recordedAt)
    ) {
      newest = result;
    }
  }
  if (newest === null) return [];
  return store.results
    .byKey(newest.key, 0)
    .filter(({ check }) => check.project === ref.project && check.testPath === ref.path);
}

function testFilePaths(ledger: Ledger): string[] {
  return [...ledger.files.values()].map((file) => file.ref.path);
}

interface Known {
  readonly checks: CheckId[];
  failing: boolean;
}

/** Checks the sink holds for this worktree, by test file. */
function knownChecks(context: SchedulerContext, ledger: Ledger): Map<string, Known> {
  const byFile = new Map<string, Known>();
  const states = context.store.knownStates.list(context.worktreeId);
  ledger.setups.restore(states);
  for (const state of states) {
    const id = testFileId({ project: state.check.project, path: state.check.testPath });
    let known = byFile.get(id);
    if (!known) {
      known = { checks: [], failing: false };
      byFile.set(id, known);
    }
    known.checks.push(state.check);
    known.failing ||= state.outcome === "fail";
  }
  return byFile;
}

function restore(file: FileState, known: Known | undefined): void {
  if (!known) return;
  file.checks = [...known.checks];
  file.failing = known.failing;
}

/**
 * The paths no runner saw change, one set per revision (`scan`): the
 * catch-up threshold is a revision's (011 C4 step 4, review wave 5, B3).
 */
export type UnseenChanges = ReadonlySet<RelativePath>[];
