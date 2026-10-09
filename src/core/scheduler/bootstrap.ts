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
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { block, type Failures } from "./failures.js";
import { durationOf, type FileState } from "./files.js";
import { takeHeldFiles } from "./held.js";
import type { Ledger } from "./ledger.js";
import { persistedNoteTexts, unmatchedInputNotes } from "./notes.js";
import { priorityOf } from "./queue.js";
import { restoreReruns } from "./rerun.js";
import { readEnvironments, resolveClosures } from "./revision.js";

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
 * persisted the same one (review wave 4.5, S5).
 *
 * `scan` is step 1, which needs no runner: the `start` revision and the
 * revision the ledger starts at. It returns the paths no runner has seen
 * change: those of the `start` revision and of every revision after the
 * refined one (`refinedMetaKey`), which an earlier daemon stored and never
 * refined, as one that exited at a reinstall did (task 001-113). The
 * baseline queues them as edits (D5 step 4).
 */
export async function scan(context: SchedulerContext, ledger: Ledger): Promise<Set<RelativePath>> {
  const { store, keys, worktreeId } = context;
  const latest = store.revisions.latest(worktreeId);
  const refined = readRefined(store, worktreeId) ?? latest?.number ?? 0;
  const revision = (await keys.bootstrap(context.head)) ?? latest;
  ledger.revision =
    revision === null
      ? { number: 0, ...(await context.head()) }
      : { number: revision.number, head: revision.head, dirty: revision.dirty };
  const changed = new Set<RelativePath>();
  if (revision === null) return changed;
  for (const { changes } of store.revisions.range(worktreeId, refined, revision.number)) {
    for (const change of changes) changed.add(change.path);
  }
  return changed;
}

/** `null` when absent or not a number, as the header reads it. */
function readRefined(store: Store, worktreeId: WorktreeId): RevisionNumber | null {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}

/**
 * Steps 2 to 4: environments, listing, keys, lookup and the baseline
 * checkpoint. `changed` holds the paths no runner saw change: those `scan`
 * returned and those revisions changed while the daemon waited for an
 * install. A miss they edited or whose closure they touch is queued recent,
 * ahead of the rest (review wave 11, S2; D5 step 4).
 */
export async function baseline(
  context: SchedulerContext,
  ledger: Ledger,
  changed: ReadonlySet<RelativePath> = NOTHING_CHANGED,
): Promise<void> {
  const { store, keys, runner, worktreeId, policy } = context;
  const failures: Failures = new Map();
  // The lookup below finds a file a heal left held as a miss (review wave 13i, B1).
  takeHeldFiles(store, worktreeId);
  await readEnvironments(context, failures);
  const listed = await tryRunner(context, "testFiles", () => runner.testFiles());
  ledger.listingFailed = listed === null;
  const previousKeys = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row]),
  );
  const refs = listed ?? [...previousKeys.values()].map((row) => row.testFile);
  const known = knownChecks(context);
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
  await resolveClosures(context, unresolved, failures);
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
  );
  const misses = [
    ...first.filter((file) => !fromStore.has(file.id)),
    ...lookup(recheck.map((file) => file.ref)),
  ];

  for (const file of misses) {
    const previous = previousKeys.get(file.id)?.key ?? null;
    if (previous === null) continue;
    // `usedAt` 0 never advances last-used: reading a duration is not a lookup hit (D8).
    const results = store.results.byKey(previous, 0);
    if (results.length === 0) {
      // Stored at a revision the last daemon never ran (task 004-54): no held fail, only a duration.
      file.durationMs = durationOf(newestResults(store, file.ref));
      continue;
    }
    // A miss at its previous key is a held inherited fail (task 001-170): no result stands here yet.
    if (previous !== file.key) file.resultKey = previous;
    file.durationMs = durationOf(results);
  }
  const unkeyed = [...ledger.files.values()].filter((file) => file.key === null);
  ledger.checkpoints.start(
    checkpointId,
    "baseline",
    ledger.revision.number,
    [...misses, ...unkeyed].map((file) => file.ref),
  );
  if (policy.baseline.onStart === "lookup-only") {
    ledger.checkpoints.finish("abandoned");
  } else {
    const recent = ledger.recentOf(changed);
    for (const file of misses) {
      ledger.enqueue(file, priorityOf(file, changed), false, recent.has(file.id));
    }
  }
  restoreReruns(context, ledger, policy.baseline.onStart !== "lookup-only");
  for (const file of unkeyed) ledger.checkpoints.failed(file.ref);
  if (failures.size > 0) block(ledger, failures);
  ledger.commit({ refined: ledger.revision.number });
  const persisted = persistedNoteTexts(store, worktreeId);
  const testFiles = testFilePaths(ledger);
  for (const text of unmatchedInputNotes(keys.unmatchedInputs(testFiles), testFiles.length)) {
    if (!persisted.has(text)) context.note(text);
  }
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
function knownChecks(context: SchedulerContext): Map<string, Known> {
  const byFile = new Map<string, Known>();
  for (const state of context.store.knownStates.list(context.worktreeId)) {
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
