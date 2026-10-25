import { type Hasher, isUnknownStat, StatCache, sameStat } from "../hash/index.js";
import { testFileId } from "../keys/index.js";
import { type BatchDiff, diffCandidates, statCandidates } from "../revision/index.js";
import { listPaths, pathsReason } from "../text.js";
import type { CheckKey, RelativePath, RunReport, TestFileRef } from "../types/index.js";

/**
 * A copy of the stat cache entries of `paths`: the inputs a tier's keys were
 * computed from. Taken when the tier is selected, because reconciliation may
 * move the live cache on while the tier runs.
 */
export function snapshotInputs(cache: StatCache, paths: Iterable<RelativePath>): StatCache {
  const snapshot = new StatCache();
  for (const path of paths) {
    const record = cache.get(path);
    if (record) snapshot.set(record, { racy: cache.isRacy(path) });
    else if (cache.hashOf(path) === null) snapshot.delete(path);
  }
  return snapshot;
}

/** What moved on disk since a snapshot of the stat cache. */
export interface Moved {
  /** Content differs. */
  readonly changed: Set<RelativePath>;
  /** Written since and ended as it was (`touchedUnchanged`). */
  readonly touched: Set<RelativePath>;
}

/**
 * Paths among `paths` whose content on disk differs from `snapshot`, and
 * those written since whose bytes ended as they were.
 *
 * Spec 001 D5: "After each tier, every closure path of the tier's test files
 * is re-stat'ed. If any hash differs from the inputs of the key the tier ran
 * under, that file's results are discarded as unreliable and the file is
 * re-queued." `diffCandidates` against the snapshot, whose updates are never
 * applied anywhere. A touch is the completion barrier of review wave-13e B2
 * (task 001-168): the watcher may report it only after the tier is recorded.
 */
export async function changedSince(
  snapshot: StatCache,
  paths: Iterable<RelativePath>,
  hasher: Hasher,
): Promise<Moved> {
  const candidates = await statCandidates(paths, hasher);
  const diff = await diffCandidates(candidates, snapshot, hasher);
  return {
    changed: new Set(diff.changes.map((change) => change.path)),
    touched: new Set(touchedUnchanged(diff, snapshot)),
  };
}

/**
 * Paths of `diff` hashed because their stat moved, with the hash they had
 * in `cache` (task 001-159). Read before `diff`'s updates reach `cache`. A
 * racy entry re-hashed on an equal stat was not written since, so it is not
 * among them. Nor is an entry stored with `unknownStat` (row 011-204): its
 * stat cannot show whether the file was written since its hash.
 */
export function touchedUnchanged(
  diff: Pick<BatchDiff, "changes" | "updates">,
  cache: StatCache,
): RelativePath[] {
  const changed = new Set(diff.changes.map((change) => change.path));
  const touched: RelativePath[] = [];
  for (const update of diff.updates) {
    if (update.kind !== "set" || changed.has(update.record.path)) continue;
    const cached = cache.get(update.record.path);
    if (cached === undefined || isUnknownStat(cached)) continue;
    if (!sameStat(cached, update.record)) touched.push(cached.path);
  }
  return touched;
}

/**
 * Review wave-13e B2 (task 001-168): `report` without `files`, since
 * `touched` were written while it was in flight and ended as they were. A
 * cache may have served the run their other bytes, and the watcher's batch
 * may reach the runner only after the tier is recorded, so the barrier
 * withholds them as a touch the runner heard does: their files are
 * `unknown` with a reason naming the paths. Task 013-02 (D2 of 013-01): only
 * `files`, those whose keys name a touched path, as a content change
 * discards them; the runner's own withholds of the rest stand. Without
 * `files`, every file of the run.
 */
export function withheldForTouch(
  report: RunReport,
  touched: readonly RelativePath[],
  files?: readonly TestFileRef[],
): RunReport {
  if (touched.length === 0) return report;
  if (files?.length === 0) return report;
  const reason = pathsReason(
    "squeal: the run may have executed bytes no check key names, since ",
    touched,
    (one) =>
      `${one ? "was" : "were"} written while this run was in flight and ended as ${one ? "it was" : "they were"}`,
    "task 001-168",
  );
  const gone = files === undefined ? null : new Set(files.map(testFileId));
  const kept = (ref: TestFileRef) => gone !== null && !gone.has(testFileId(ref));
  const { fileDurations, observed, reads, withheld, ...rest } = report;
  const stillWithheld = withheld?.filter(kept) ?? [];
  return {
    ...rest,
    completedFiles: report.completedFiles.filter(kept),
    results: report.results.filter((r) =>
      kept({ project: r.check.project, path: r.check.testPath }),
    ),
    fileErrors: report.fileErrors.filter((e) => kept(e.testFile)),
    failure: report.failure === null ? reason : `${report.failure}\n${reason}`,
    ...(fileDurations ? { fileDurations: fileDurations.filter((d) => kept(d.testFile)) } : {}),
    ...(observed ? { observed: observed.filter((o) => kept(o.testFile)) } : {}),
    ...(reads ? { reads: reads.filter((o) => kept(o.testFile)) } : {}),
    ...(stillWithheld.length > 0 ? { withheld: stillWithheld } : {}),
  };
}

/** A file of a tier and the key it ran under. */
export interface Ran {
  readonly file: { readonly id: string; readonly ref: TestFileRef };
  readonly key: CheckKey;
}

/** A tier's file as the barrier reads it: what must hold still during its run (`TierFile.inputs`). */
export interface Barred extends Ran {
  readonly inputs: readonly RelativePath[];
}

/**
 * Task 013-02 (D2 of 013-01): the completion barrier over a tier. A file is
 * barred when its keys name a path `touched` holds, among its inputs or
 * what its run read beyond them (`growth`, by file id), as a content change
 * of that path would re-key it; `withheldForTouch` withholds the barred
 * files, naming the paths they name, and the rest of the run stands.
 */
export function barredByTouch<T extends Barred>(
  report: RunReport,
  files: readonly T[],
  touched: readonly RelativePath[],
  growth?: ReadonlyMap<string, { readonly growth: readonly RelativePath[] }>,
): { readonly report: RunReport; readonly barred: T[]; readonly paths: RelativePath[] } {
  const isTouched = new Set(touched);
  const named = (paths: readonly RelativePath[] = []) => paths.filter((p) => isTouched.has(p));
  const touchedOf = (ran: T) => [...named(ran.inputs), ...named(growth?.get(ran.file.id)?.growth)];
  const barred = files.filter((ran) => touchedOf(ran).length > 0);
  const paths = [...new Set(barred.flatMap(touchedOf))].sort();
  const withheld = withheldForTouch(
    report,
    paths,
    barred.map(({ file }) => file.ref),
  );
  return { report: withheld, barred, paths };
}

/** A withheld tier's files: those withheld at their key for the first time, and the rest. */
export interface Withheld<T extends Ran> {
  readonly again: readonly T[];
  readonly exhausted: readonly T[];
}

/**
 * Task 007-30: no revision follows a touch that ended as it was, so a tier
 * `withheldForTouch` withholds would leave its files `unknown` with nothing
 * queued. Instead each file runs once more under its key, once the runner
 * heard the touch. Each withheld file is remembered with the key it ran
 * under until a run of it is recorded unwithheld; a file withheld at that
 * key already is withheld for good, whatever tier it shares (review 007-31,
 * B1). A path touched on every run ends there: only a revision moves a key,
 * and a new key is new work, with its own run once more.
 */
export class Withholds {
  readonly #keys = new Map<string, CheckKey>();

  /** Records the withhold of `files`, each first or exhausted at its key. */
  record<T extends Ran>(files: readonly T[]): Withheld<T> {
    const withheld = this.peek(files);
    for (const { file, key } of files) this.#keys.set(file.id, key);
    return withheld;
  }

  /**
   * What `record` would make of `files`, recording nothing (row 011-128): a
   * record decides before its write, and counts only once the write lands.
   */
  peek<T extends Ran>(files: readonly T[]): Withheld<T> {
    const again: T[] = [];
    const exhausted: T[] = [];
    for (const ran of files) {
      (this.#keys.get(ran.file.id) === ran.key ? exhausted : again).push(ran);
    }
    return { again, exhausted };
  }

  /** `files` were recorded unwithheld: their withholds are no longer in a row. */
  clear(files: readonly Ran[]): void {
    for (const { file } of files) this.#keys.delete(file.id);
  }
}

/**
 * The daemon note of a withhold (task 007-30), naming the touched paths:
 * the 001-168 reason reaches status while the retry is pending, and a file
 * with no known check, whose summaries show nothing, still has it.
 */
export function withholdNote(
  touched: readonly RelativePath[],
  files: readonly Ran[],
  retry: boolean,
): string | null {
  if (files.length === 0) return null;
  const paths = listPaths(touched);
  const ran = listPaths(files.map(({ file }) => file.ref.path));
  return retry
    ? `squeal: ${paths} was written while ${ran} ran and ended as it was; the run is withheld and runs once more (tasks 001-168, 007-30)`
    : `squeal: ${paths} was written during 2 runs in a row of ${ran} and ended as it was; ${ran} stays unknown until an input changes, so write it outside the worktree or under an ignored path, or declare it (tasks 001-168, 007-30)`;
}
