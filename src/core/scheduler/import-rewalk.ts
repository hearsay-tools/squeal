import { sameList } from "../fs/compare.js";
import { assembleClosure } from "../keys/closure.js";
import { testFileId } from "../keys/reverse-index.js";
import { recordImportGraph } from "../store/import-edges.js";
import { storedWalkKeys } from "../store/import-graph.js";
import type { RelativePath, WorktreeId } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { RunnerClosure } from "../types/runner.js";
import { worktreeMetaKey } from "../types/store.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";

/*
 * Row 015-117 (spec 015 D11 as amended by the human, P1; lessons "Edit
 * reach, round 1", defect 1): after an upgrade the daemon reads, once, the
 * imports of every listed test file whose current key has no stored walk,
 * so `squeal reach` counts the whole suite. A start keys most test files
 * from stored closures and walks only the misses, so without this a
 * current file is walked again only when an edit or a run reaches it.
 *
 * It starts when the pump has nothing else to do, after the start-up work
 * and the baseline, and goes a chunk at a time as runner work: an edit's
 * refinement or a tier takes its turn between two chunks, and a file a
 * revision changed while its chunk was read is left to that revision. It
 * runs no test and moves no key: a walk is stored under the file's current
 * key only when the fresh closure is the one that key covers
 * (`keysAlike`). It runs once per daemon version: a marker in the store,
 * a row of the worktree's (`WORKTREE_META_ROWS`), names the version that
 * finished a pass that walked something.
 */

/** Test files a chunk walks: about a second of the runner's time on a suite like Squeal's. */
export const REWALK_CHUNK = 32;

/** The `meta` key of a worktree's re-walk marker: the daemon version that finished one. */
export function rewalkMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("importRewalk", worktreeId);
}

/**
 * One daemon's re-walk pass. It goes until nothing is left to walk: each
 * time its list runs out it looks again, so a file whose key moved since
 * (start-up keys files from other worktrees' newest closures, then
 * re-keys them; proof round 2) is walked at its new key. A file is given
 * up at a key, not for good: refused, when its fresh closure is not the
 * one the key covers, or failed, when the runner's call failed. Either is
 * tried again once its key moves.
 */
export class ImportRewalk {
  #pending: TestFileRef[] = [];
  #looked = false;
  #walked = 0;
  #done = false;
  /** By test file, the key it was refused at. */
  readonly #refused = new Map<string, CheckKey>();
  /** By test file, the key its closure call failed at. */
  readonly #failed = new Map<string, CheckKey>();

  constructor(private readonly version: string) {}

  /**
   * The next chunk to walk; `null` once nothing is left. Then every listed
   * Vitest test file at its current key has a walk, or was refused or
   * failed at that very key, and the pass writes its marker unless a call
   * failed (the next start tries those again) or it walked nothing.
   */
  next(context: SchedulerContext, ledger: Ledger): readonly TestFileRef[] | null {
    if (this.#done) return null;
    const marker = rewalkMetaKey(context.worktreeId);
    if (!this.#looked) {
      this.#looked = true;
      if (context.store.meta.get(marker) === this.version) return this.#finish();
    }
    if (this.#pending.length === 0) this.#pending = this.#eligible(context, ledger);
    const chunk = this.#pending.splice(0, REWALK_CHUNK);
    if (chunk.length > 0) return chunk;
    if (this.#walked > 0 && this.#failed.size === 0) context.store.meta.set(marker, this.version);
    return this.#finish();
  }

  /**
   * Stores, under the lock, the walks of `closures` that still belong to
   * their file's current key: the file is listed and keyed, no revision
   * changed a path of its closure while `chunk` was read, and the closure
   * assembles to the one the key covers. No closure is set. A file changed
   * meanwhile is left to its revision, and looked at again after it.
   */
  apply(
    context: SchedulerContext,
    ledger: Ledger,
    chunk: readonly TestFileRef[],
    closures: readonly RunnerClosure[],
    changedMeanwhile: ReadonlySet<RelativePath>,
  ): void {
    const answered = new Set(closures.map((closure) => testFileId(closure.testFile)));
    for (const ref of chunk) {
      const key = context.keys.index.key(ref);
      if (!answered.has(testFileId(ref)) && key !== null) this.#failed.set(testFileId(ref), key);
    }
    this.#walked += closures.length;
    const kept: RunnerClosure[] = [];
    for (const closure of closures) {
      const ref = closure.testFile;
      const key = context.keys.index.key(ref);
      if (!ledger.file(ref) || key === null) continue;
      if ([ref.path, ...closure.paths].some((path) => changedMeanwhile.has(path))) continue;
      if (keysAlike(context, closure)) kept.push(closure);
      else this.#refused.set(testFileId(ref), key);
    }
    if (kept.length > 0) recordImportGraph(context, { closures: kept });
  }

  /** What is left to walk: unwalked, and not given up at the key it holds now. */
  #eligible(context: SchedulerContext, ledger: Ledger): TestFileRef[] {
    return unwalked(context, ledger).filter((ref) => {
      const id = testFileId(ref);
      const key = context.keys.index.key(ref);
      return this.#refused.get(id) !== key && this.#failed.get(id) !== key;
    });
  }

  #finish(): null {
    this.#done = true;
    this.#pending = [];
    return null;
  }
}

/**
 * Whether `runner` assembles, as `setClosure` does, to the very closure the
 * worktree keys its test file by: then its walk belongs to the current
 * key, and storing it moves no key.
 */
function keysAlike(context: SchedulerContext, runner: RunnerClosure): boolean {
  const { keys } = context;
  const ref = runner.testFile;
  const current = keys.index.closure(ref);
  if (current === undefined) return false;
  const observed = keys.observes(ref.project)
    ? keys.effectiveObserved(ref, keys.observedOf(ref))
    : [];
  return sameList(
    assembleClosure(runner, keys.declaredFor(ref.path), observed).paths,
    current.paths,
  );
}

/**
 * The listed test files of Vitest projects (the runner that gives import
 * edges) whose current key has no stored walk, in the ledger's order.
 */
function unwalked(context: SchedulerContext, ledger: Ledger): TestFileRef[] {
  const stored = storedWalkKeys(context.store);
  const runners = context.store.checks.runnersOf(context.worktreeId);
  const out: TestFileRef[] = [];
  for (const file of ledger.files.values()) {
    const ref = file.ref;
    const runner = runners.get(ref.project);
    if (runner !== undefined && runner !== "vitest") continue;
    const key = context.keys.index.key(ref);
    if (key === null || stored.has(`${ref.project}\0${ref.path}\0${key}`)) continue;
    out.push(ref);
  }
  return out.sort((a, b) => (testFileId(a) < testFileId(b) ? -1 : 1));
}
