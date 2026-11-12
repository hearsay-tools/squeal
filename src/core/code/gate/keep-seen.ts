import type { StatCache } from "../../hash/stat-cache.js";
import { ModuleSets } from "../../keys/modules.js";
import { ObservedSets } from "../../keys/observed.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { FileDecision } from "../../run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import { type InputCheck, type KeepWriter, type Kept, sliced } from "./keep-write.js";

/*
 * Row 020-39 (spec 020 D17.3; `research/no-daemon-reuse.md`, option 1;
 * `011-core/research/run-evidence.md`, difference 1): where no daemon
 * serves, `squeal code` keeps a file whose run read paths beyond its key
 * at the key with them (`grown`), and merges the run's reads into the
 * shared observed rows, as the daemon's record does (`recordCompleted`,
 * `endRecord`'s `writeSeen`). The lookup's keys sit on a scratch store
 * (`gate/stored.ts`), so the grown key is theirs, and the merge goes to the
 * repository's store through the daemon's own views (`ObservedSets`,
 * `ModuleSets`, `SharedPaths.write`). A read first seen during the run, a
 * git-ignored one say, keeps no file, but its merge keys the next run with
 * it, which keeps the file.
 */

/** What one completed file's run read that the shared rows may lack. */
export interface Seen {
  readonly ref: TestFileRef;
  /** Its reads beyond its key (`ObservedGrowth.add`): the `observed.` row. */
  readonly add: readonly RelativePath[];
  /** What a process it started imported (`markDirect`): the `observedDirect.` row. */
  readonly direct: readonly RelativePath[];
  /** Its module loads (`markModules`): the `observedModules.` row. */
  readonly modules: readonly RelativePath[];
}

/**
 * The reads of each of `files` to merge, as the daemon's record merges
 * them: a completed file's growth (each decision but an incomplete run's
 * carries it), and the direct and module marks its run reported that the
 * lookup's keys took (`observedGrowth`). Files with none are left out.
 */
export function seenOf(
  keys: Pick<WorktreeKeys, "directOf" | "modulesOf">,
  report: RunReport,
  files: readonly Pick<Kept, "ref">[],
  decided: ReadonlyMap<string, FileDecision>,
): Seen[] {
  const reported = new Map((report.observed ?? []).map((o) => [testFileId(o.testFile), o]));
  const out: Seen[] = [];
  for (const { ref } of files) {
    const id = testFileId(ref);
    const at = decided.get(id)?.decision;
    const add = at !== undefined && "growth" in at ? (at.growth?.add ?? []) : [];
    const observed = reported.get(id);
    const direct = among(() => keys.directOf(ref), observed?.direct);
    const modules = among(() => keys.modulesOf(ref), observed?.modules);
    if (add.length + direct.length + modules.length > 0) out.push({ ref, add, direct, modules });
  }
  return out;
}

/**
 * `file` at the key `decided` stores it under: the key it ran under, or
 * its grown key once its reads join its closure in the lookup's keys
 * (`addObserved`, as `recordCompleted` does), with its reads among the
 * paths its later checks compare, and their stat cache entries copied to
 * `before`. `null` when the grown file has no key.
 */
export function atStoreKey(
  keys: Pick<WorktreeKeys, "addObserved" | "index" | "cache">,
  before: StatCache,
  file: Kept,
  decided: FileDecision,
): Kept | null {
  const { decision } = decided;
  if (decision.kind !== "store" || decision.at === "ran" || decision.growth === undefined) {
    return file;
  }
  const { add, growth } = decision.growth;
  keys.addObserved(file.ref, add);
  const key = keys.index.key(file.ref);
  if (key === null) return null;
  copyMissing(before, keys.cache, growth);
  return { ...file, key, paths: [...file.paths, ...growth], grown: decided };
}

/**
 * Merges `seen` into `store`'s shared rows, in one transaction when they
 * lack a path, as the daemon's `writeSeen`: each view reads the row, then
 * `write` reads it again inside the transaction and adds what it lacks, so
 * no other worktree's paths are dropped. Synchronous: the caller's busy
 * slice tries it (`writeHere`).
 */
export function mergeSeen(store: Store, seen: readonly Seen[]): void {
  const observed = new ObservedSets(store);
  const modules = new ModuleSets(store);
  let lacking = false;
  for (const { ref, add, direct, modules: loads } of seen) {
    if (add.length > 0 && observed.see(ref, add).length > 0) lacking = true;
    if (direct.length > 0 && observed.mark(ref, direct).length > 0) lacking = true;
    const known = new Set(loads.length === 0 ? [] : modules.of(ref));
    const newLoads = loads.filter((path) => !known.has(path));
    if (newLoads.length > 0) {
      modules.mark(ref, newLoads);
      lacking = true;
    }
  }
  if (!lacking) return;
  store.transaction(() => {
    observed.write();
    modules.write();
  });
}

/** The paths of `held` that `reported` names, `held` read only then; none without a report. */
function among(
  held: () => readonly RelativePath[],
  reported: readonly RelativePath[] | undefined,
): RelativePath[] {
  if (reported === undefined || reported.length === 0) return [];
  const named = new Set(reported);
  return held().filter((path) => named.has(path));
}

/** Copies to `before` the entries of `cache` for each of `paths` it holds nothing of. */
function copyMissing(before: StatCache, cache: StatCache, paths: readonly RelativePath[]): void {
  for (const path of paths) {
    if (before.hashOf(path) !== undefined) continue;
    const record = cache.get(path);
    if (record !== undefined) before.set(record, { racy: cache.isRacy(path) });
    else if (cache.hashOf(path) === null) before.delete(path);
  }
}

/**
 * The merge of `seen` by `writer`, before the files' writes, tried as they
 * are (`sliced`): a busy store's refusal owes every later write its input
 * check and counts toward the one bound (D17.5). "kept" when there is
 * nothing to merge, or the writer merges nothing (a serving daemon's).
 */
export async function keepSeen(
  writer: KeepWriter,
  seen: readonly Seen[],
  at: {
    readonly database: AbsolutePath;
    readonly giveUp: (database: AbsolutePath) => boolean;
    readonly check: InputCheck;
  },
): Promise<"kept" | "spent"> {
  const merge = writer.seen;
  if (merge === undefined || seen.length === 0) return "kept";
  const outcome = await sliced(
    () => merge(seen),
    async (busy) => {
      at.check.owe();
      return busy && at.giveUp(at.database) ? "spent" : null;
    },
  );
  return outcome === "spent" ? "spent" : "kept";
}
