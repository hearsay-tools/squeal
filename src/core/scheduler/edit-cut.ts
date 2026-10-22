import { compare } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type {
  AffectedTestFiles,
  RelativePath,
  RevisionNumber,
  RunnerClosure,
  TestFileRef,
} from "../types/index.js";
import { type SchedulerContext, tryRunner } from "./context.js";
import type { FileState } from "./files.js";
import type { Ledger } from "./ledger.js";
import { namesakesOf } from "./namesakes.js";
import { listPaths } from "./notes.js";
import type { RunnerPartBound } from "./runner-work-bound.js";

/**
 * What the edit cut needs from a revision's runner part (spec 011 C4 step 4
 * as amended 2026-10-20, task 011-25), read with `affected` and without the
 * scheduler lock.
 */
export interface EditCut {
  /** Each source the revision changed that a closure holds, with its namesakes' `testFileId`s. */
  readonly namesakes: ReadonlyMap<RelativePath, readonly string[]>;
  /** The sources none of whose namesakes the revision reached. */
  readonly bare: ReadonlySet<RelativePath>;
  /** `testFileId`s of the runner's direct importers of `bare`. */
  readonly fallback: ReadonlySet<string>;
  /** `testFileId`s of the runner's transitive importers of the revision's paths (task 011-116). */
  readonly transitive: ReadonlySet<string>;
}

/**
 * The cut of a revision that changed `paths`, given the runner's `affected`
 * for them. A source is a changed path that is no test file and that a
 * closure holds, stored or among the runner part's `closures` (review wave
 * 6, B1: a source an import first resolves to now, as a new `src/a.js`
 * beside `src/a.ts`); a declared input or a path no closure holds has no
 * importers to keep. When some sources have no namesake the revision
 * reaches and others do, the runner is asked again for the bare ones alone,
 * since `affected` answers for its paths together; with no answer every
 * direct importer of the revision stands for theirs.
 */
export async function fetchEditCut(
  context: SchedulerContext,
  testFiles: Iterable<TestFileRef>,
  paths: readonly RelativePath[],
  affected: AffectedTestFiles,
  bound: RunnerPartBound,
  closures: readonly RunnerClosure[] = [],
): Promise<EditCut> {
  const { keys, runner } = context;
  const byPath = new Map<RelativePath, string[]>();
  for (const ref of testFiles)
    byPath.set(ref.path, [...(byPath.get(ref.path) ?? []), testFileId(ref)]);
  const reached = new Set([...affected.direct, ...affected.transitive].map(testFileId));
  for (const ref of keys.index.reverse.referencing(paths)) reached.add(testFileId(ref));
  const fetched = new Set(closures.flatMap((closure) => closure.paths));
  const held = (path: RelativePath) =>
    fetched.has(path) || keys.index.reverse.referencing([path]).length > 0;
  const namesakes = new Map<RelativePath, readonly string[]>();
  const bare = new Set<RelativePath>();
  for (const path of new Set(paths)) {
    if (byPath.has(path) || !held(path)) continue;
    const ids = namesakesOf(path, byPath.keys()).flatMap((name) => byPath.get(name) ?? []);
    namesakes.set(path, ids);
    if (!ids.some((id) => reached.has(id))) bare.add(path);
  }
  const direct = affected.direct.map(testFileId);
  const transitive = new Set(affected.transitive.map(testFileId));
  if (bare.size === 0) return { namesakes, bare, fallback: new Set(), transitive };
  if (bare.size === namesakes.size)
    return { namesakes, bare, fallback: new Set(direct), transitive };
  const own = await tryRunner(context, `affected (${listPaths([...bare])})`, () =>
    bound.call(() => runner.affected([...bare])),
  );
  const fallback = new Set(own === null ? direct : own.direct.map(testFileId));
  return { namesakes, bare, fallback, transitive };
}

/**
 * The `testFileId`s of the files a revision that changed `changed` reaches
 * (`Ledger.recentOf` with the runner's `direct`) and keeps as an edit's
 * work: the test files it added or edited; each source's namesakes it
 * reached, or for a source with none its direct importers; and the
 * `runner.tierSize` shortest by last-known duration, unknown last, of its
 * other direct importers, then of the files that import a changed path
 * through other modules or whose runs read it. Every other file it reaches
 * is catch-up, a file a declared input alone reaches among them. On cezar
 * this cut the next edit's wait at p90 from 132 s to 8 s, and reported 1 of
 * 75 revisions' first new failure later, by 63 s (`research/edit-cut.md`).
 * In toolkit-dev the only check of an edit read it at run time, and as
 * catch-up waited 46.4 s for a permit (task 011-116,
 * `research/edit-latency.md`).
 */
export function editWork(
  context: SchedulerContext,
  ledger: Ledger,
  cut: EditCut,
  changed: ReadonlySet<RelativePath>,
  direct: ReadonlySet<string>,
): { kept: Set<string>; reached: Set<string> } {
  const reached = ledger.recentOf(changed, direct);
  const kept = new Set<string>();
  for (const file of ledger.files.values()) if (changed.has(file.ref.path)) kept.add(file.id);
  for (const [source, ids] of cut.namesakes) {
    const own = ids.filter((id) => reached.has(id));
    // A source whose namesake the closures reached only once the runner part applied them.
    const fallback = cut.bare.has(source) ? cut.fallback : direct;
    for (const id of own.length > 0 ? own : fallback) kept.add(id);
  }
  const beyond = heldBeyondInputs(context, changed);
  const rest = [...reached].filter((id) => !kept.has(id) && !direct.has(id));
  const reads = rest.filter((id) => cut.transitive.has(id) || beyond.has(id));
  const others = [
    ...shortest(
      ledger,
      [...direct].filter((id) => !kept.has(id)),
    ),
    ...shortest(ledger, reads),
  ];
  for (const file of others.slice(0, context.policy.runner.tierSize)) kept.add(file.id);
  return { kept, reached };
}

/** The files of `ids` the ledger knows, shortest last-known duration first, unknown last. */
function shortest(ledger: Ledger, ids: readonly string[]): FileState[] {
  return ids
    .map((id) => ledger.files.get(id))
    .filter((file): file is FileState => file !== undefined)
    .sort(shortestFirst);
}

/**
 * The `testFileId`s of the files whose closure holds a path of `changed`
 * other than as a declared input alone: an import, a snapshot, or a path a
 * run read, even one a declared input selects too (task 011-116).
 */
function heldBeyondInputs(
  context: SchedulerContext,
  changed: ReadonlySet<RelativePath>,
): Set<string> {
  const { keys } = context;
  const ids = new Set<string>();
  for (const path of changed) {
    for (const ref of keys.index.reverse.referencing([path])) {
      const declared = keys.declaredFor(ref.path).includes(path);
      if (!declared || keys.observedOf(ref).includes(path)) ids.add(testFileId(ref));
    }
  }
  return ids;
}

/**
 * Makes catch-up of what `revision` queued as an edit's work and does not
 * keep (`Queue.toCatchUp`): another revision's edit or a promotion still
 * holds a file in the first group.
 */
export function demote(
  ledger: Ledger,
  ids: Iterable<string>,
  kept: ReadonlySet<string>,
  revision: RevisionNumber,
): void {
  for (const id of ids) {
    const file = ledger.files.get(id);
    if (file !== undefined && !kept.has(id)) ledger.queue.toCatchUp(file.ref, revision);
  }
}

function shortestFirst(a: FileState, b: FileState): number {
  const x = a.durationMs ?? Number.POSITIVE_INFINITY;
  const y = b.durationMs ?? Number.POSITIVE_INFINITY;
  return x === y ? compare(a.id, b.id) : x < y ? -1 : 1;
}

/**
 * A daemon start's cut of one unrefined revision that changed `paths`, of
 * fewer keyed paths than catch-up takes (011 C4 step 4 as amended for
 * 011-25): the runner's `affected` for them, bounded as the baseline's
 * other calls, then `editWork`. `kept` is `null` when `affected` gave no
 * answer, so every file it reaches stays an edit's work.
 */
export async function cutAtStart(
  context: SchedulerContext,
  ledger: Ledger,
  paths: ReadonlySet<RelativePath>,
  bound: RunnerPartBound,
): Promise<{ kept: Set<string> | null; reached: Set<string>; direct: ReadonlySet<string> }> {
  const list = [...paths];
  const affected = await tryRunner(context, `affected (${listPaths(list)})`, () =>
    bound.call(() => context.runner.affected(list)),
  );
  if (affected === null) return { kept: null, reached: ledger.recentOf(paths), direct: new Set() };
  const direct = new Set(affected.direct.map(testFileId));
  const refs = [...ledger.files.values()].map((file) => file.ref);
  const cut = await fetchEditCut(context, refs, list, affected, bound);
  return { ...editWork(context, ledger, cut, paths, direct), direct };
}
