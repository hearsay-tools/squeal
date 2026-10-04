import { randomUUID } from "node:crypto";
import { testFileId } from "../keys/index.js";
import type { CheckId, CheckKey, TestFileRef } from "../types/index.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";
import { resolveClosure, storeClosures } from "./revision.js";

/**
 * Daemon start in a worktree.
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
 * 4. One checkpoint of kind `baseline` over the misses, run in tiers or,
 *    with `baseline.onStart: "lookup-only"`, abandoned unless empty.
 *
 * What the last daemon of this worktree knew comes back from the store:
 * known checks and failures from `known_states`, the previous key from
 * `test_file_keys`. Test files that are gone are forgotten and their checks
 * retired.
 */
export async function bootstrap(context: SchedulerContext, ledger: Ledger): Promise<void> {
  const { store, keys, runner, worktreeId, policy } = context;
  const latest = store.revisions.latest(worktreeId);
  const revision = (await keys.bootstrap(context.head)) ?? latest;
  ledger.revision =
    revision === null
      ? { number: 0, ...(await context.head()) }
      : { number: revision.number, head: revision.head, dirty: revision.dirty };

  const environments = await tryRunner(context, "environment", () => runner.environment());
  if (environments !== null) await keys.setEnvironments(environments);
  const refs = (await tryRunner(context, "testFiles", () => runner.testFiles())) ?? [];

  const previousKeys = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row]),
  );
  const known = knownChecks(context);
  const fromStore = new Set<string>();
  const resolved: TestFileRef[] = [];
  for (const ref of refs) {
    const file = ledger.addFile(ref);
    restore(file, known.get(file.id));
    const record = store.testFiles.get(ref);
    if (record !== null) {
      keys.setClosure({ testFile: ref, paths: record.closure.paths });
      fromStore.add(file.id);
    } else if ((await resolveClosure(context, ref)) !== null) {
      resolved.push(ref);
    }
  }
  await keys.trackUntracked();
  for (const row of previousKeys.values()) {
    if (ledger.file(row.testFile)) continue;
    const gone = ledger.addFile(row.testFile);
    restore(gone, known.get(gone.id));
    ledger.removeFile(gone);
  }

  const checkpointId = randomUUID();
  const lookup = (files: Iterable<TestFileRef>) =>
    ledger.settle(files, NOTHING_CHANGED, { checkpointId, queueMisses: false });
  const first = lookup(refs);
  const recheck = first.filter((file) => fromStore.has(file.id));
  for (const file of recheck) {
    if ((await resolveClosure(context, file.ref)) !== null) resolved.push(file.ref);
  }
  await keys.trackUntracked();
  storeClosures(context, resolved);
  // Each test file is one lookup, however many times it is keyed.
  ledger.counters.misses -= recheck.length;
  const misses = [
    ...first.filter((file) => !fromStore.has(file.id)),
    ...lookup(recheck.map((file) => file.ref)),
  ];

  for (const file of misses) {
    const previous = previousKeys.get(file.id)?.key ?? null;
    if (previous !== null && hasResults(context, previous)) file.resultKey = previous;
  }
  ledger.checkpoints.start(
    checkpointId,
    "baseline",
    ledger.revision.number,
    misses.map((file) => file.ref),
  );
  if (policy.baseline.onStart === "lookup-only") {
    ledger.checkpoints.finish("abandoned");
  } else {
    for (const file of misses) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
  }
  ledger.commit();
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

function hasResults(context: SchedulerContext, key: CheckKey): boolean {
  return context.store.results.checksForKey(key).length > 0;
}
