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
 * time its list runs out it looks again. A file whose walk was not stored
 * is given up at the key it held, not for good: its fresh closure is not
 * the one the key covers, the runner's call failed, a revision changed it
 * meanwhile, or there is nothing to store. Each file is tried at most once
 * at a key, so the pass ends.
 *
 * A file given up at a key that moves later is tried again at its new
 * key, during the pass and after it, at the pump's next idle point, so
 * after the revision or the run that moved it: a key a start took from
 * another worktree's closure moves to this worktree's own only then
 * (proof round 2). After the pass only those files are looked at, while
 * they have no walk at their new key; an edit's refinement or a run
 * stores one for most.
 */
export class ImportRewalk {
  #pending: TestFileRef[] = [];
  #looked = false;
  #walked = 0;
  #failed = false;
  #ended = false;
  /** By test file, the file and the key it was given up at. */
  readonly #givenUp = new Map<string, { readonly ref: TestFileRef; readonly key: CheckKey }>();

  constructor(private readonly version: string) {}

  /**
   * The next chunk to walk; `null` when nothing is left. At the end of the
   * pass every listed Vitest test file at its current key has a walk or was
   * given up at that very key, and the pass writes its marker unless a
   * call failed (the next start tries those again) or it walked nothing.
   * After the end, the given-up files whose key moved.
   */
  next(context: SchedulerContext, ledger: Ledger): readonly TestFileRef[] | null {
    const marker = rewalkMetaKey(context.worktreeId);
    if (!this.#looked) {
      this.#looked = true;
      this.#ended = context.store.meta.get(marker) === this.version;
    }
    if (this.#ended) return this.#moved(context, ledger);
    if (this.#pending.length === 0) this.#pending = this.#eligible(context, ledger);
    const chunk = this.#pending.splice(0, REWALK_CHUNK);
    if (chunk.length > 0) return chunk;
    if (this.#walked > 0 && !this.#failed) context.store.meta.set(marker, this.version);
    this.#ended = true;
    return null;
  }

  /**
   * Stores, under the lock, the walks of `closures` that still belong to
   * their file's current key: the file is listed and keyed with an
   * environment, no revision changed a path of its closure while `chunk`
   * was read, the runner gave its imports, and the closure assembles to the
   * one the key covers. No closure is set. Every other file of `chunk` is
   * given up at its current key.
   */
  apply(
    context: SchedulerContext,
    ledger: Ledger,
    chunk: readonly TestFileRef[],
    closures: readonly RunnerClosure[],
    changedMeanwhile: ReadonlySet<RelativePath>,
  ): void {
    this.#walked += closures.length;
    if (closures.length < chunk.length) this.#failed = true;
    const kept = closures.filter((closure) => {
      const ref = closure.testFile;
      if (!ledger.file(ref) || closure.imports === undefined) return false;
      if (context.keys.index.environment(ref.project) === undefined) return false;
      if ([ref.path, ...closure.paths].some((path) => changedMeanwhile.has(path))) return false;
      return keysAlike(context, closure);
    });
    if (kept.length > 0) recordImportGraph(context, { closures: kept });
    const stored = new Set(kept.map((closure) => testFileId(closure.testFile)));
    for (const ref of chunk) {
      const id = testFileId(ref);
      const key = context.keys.index.key(ref);
      if (stored.has(id) || key === null) this.#givenUp.delete(id);
      else this.#givenUp.set(id, { ref, key });
    }
  }

  /** What is left to walk: unwalked, and not given up at the key it holds now. */
  #eligible(context: SchedulerContext, ledger: Ledger): TestFileRef[] {
    return unwalked(context, ledger).filter(
      (ref) => this.#givenUp.get(testFileId(ref))?.key !== context.keys.index.key(ref),
    );
  }

  /**
   * After the pass: the given-up files whose key moved and that have no
   * walk at their new key. A file with one, or that is not listed or keyed
   * any more, is forgotten. Without a moved key, no store read.
   */
  #moved(context: SchedulerContext, ledger: Ledger): readonly TestFileRef[] | null {
    const moved = [...this.#givenUp.values()].filter(
      ({ ref, key }) => context.keys.index.key(ref) !== key,
    );
    if (moved.length === 0) return null;
    const left = new Set(unwalked(context, ledger).map(testFileId));
    const chunk: TestFileRef[] = [];
    for (const { ref } of moved) {
      if (!left.has(testFileId(ref))) this.#givenUp.delete(testFileId(ref));
      else if (chunk.length < REWALK_CHUNK) chunk.push(ref);
    }
    return chunk.length > 0 ? chunk : null;
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
