import { testFileId } from "../keys/index.js";
import type { AffectedTestFiles, NarrowRun, RelativePath, TestFileRef } from "../types/index.js";
import type { CommitAsk } from "./commit-asks.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { editWork, fetchEditCut, observedDirectOf } from "./edit-cut.js";
import { classify } from "./files.js";
import type { Ledger } from "./ledger.js";
import { runnerPartBound } from "./runner-work-bound.js";
import { groupView } from "./slow.js";

/*
 * Spec 019 D6 "Narrow run" (row 019-49): `squeal run <group> <path>...`
 * runs now only the test files of the group that the paths select. A test
 * file's path selects itself. Another path selects the edit work 011 C4
 * step 4 keeps for it among a group's files (`editWork` with `within`): the
 * source's namesakes, or with none its direct importers, then the
 * `runner.tierSize` shortest of its other direct importers. The other
 * groups' selections and the group's other readers are only named.
 */

/** What `paths` select, by group: each group's selected and reached `testFileId`s. */
interface Selection {
  readonly selected: Map<string, Set<string>>;
  /** Per group, the paths that select a file of it. */
  readonly paths: Map<string, Set<RelativePath>>;
  readonly reached: Set<string>;
  readonly unmatched: RelativePath[];
}

/**
 * The selection of `paths`, under the lock in runner work: a source path
 * asks the runner's `affected` for itself alone, bounded as a runner part,
 * so each path's edit work is its own. A runner that gives no answer leaves
 * the stored index's readers and direct marks.
 */
export async function selectNarrow(
  context: SchedulerContext,
  ledger: Ledger,
  paths: readonly RelativePath[],
): Promise<Selection> {
  const { of } = groupView(context.policy);
  const groupOf = new Map([...ledger.files.values()].map((f) => [f.id, of(f.ref).name]));
  const selection: Selection = {
    selected: new Map(),
    paths: new Map(),
    reached: new Set(),
    unmatched: [],
  };
  const add = (id: string, path: RelativePath) => {
    const group = groupOf.get(id);
    if (group === undefined) return;
    selection.selected.set(group, (selection.selected.get(group) ?? new Set()).add(id));
    selection.paths.set(group, (selection.paths.get(group) ?? new Set()).add(path));
  };
  const refs = [...ledger.files.values()].map((file) => file.ref);
  const bound = runnerPartBound(context);
  for (const path of new Set(paths)) {
    const own = refs.filter((ref) => ref.path === path);
    if (own.length > 0) {
      for (const ref of own) add(testFileId(ref), path);
      continue;
    }
    const affected: AffectedTestFiles = (await tryRunner(context, `affected (${path})`, () =>
      bound.call(() => context.runner.affected([path])),
    )) ?? { direct: [], transitive: [] };
    const direct = new Set(affected.direct.map(testFileId));
    const observed = observedDirectOf(context.keys, [path], direct);
    const cut = await fetchEditCut(context, refs, [path], affected, bound);
    const changed = new Set([path]);
    const { reached } = editWork(context, ledger, cut, changed, direct, observed);
    for (const id of reached) selection.reached.add(id);
    const groups = new Set([...reached].flatMap((id) => groupOf.get(id) ?? []));
    let any = false;
    for (const group of groups) {
      const within = (id: string) => groupOf.get(id) === group;
      const { kept } = editWork(context, ledger, cut, changed, direct, observed, within);
      for (const id of kept) add(id, path);
      any ||= kept.size > 0;
    }
    if (!any) selection.unmatched.push(path);
  }
  return selection;
}

/**
 * Queues group `group`'s selected files that are not current, as `squeal
 * run <group>` queues the whole group (`queueGroup`): a `lookup-only` miss
 * or an `unknown` file is queued. Returns the asks for the group's lane, at
 * each file's key, and how many files are queued or running for it.
 */
export function queueNarrow(
  ledger: Ledger,
  ids: ReadonlySet<string>,
): { readonly queued: number; readonly asks: readonly CommitAsk[] } {
  const open = [...ids]
    .flatMap((id) => ledger.files.get(id) ?? [])
    .filter((file) => file.key !== null && file.blocked === null && classify(file) !== "current");
  for (const file of open) file.unknownKey = null;
  const pending = open.filter((file) => file.phase !== null);
  const misses = ledger.settle(
    open.filter((file) => file.phase === null).map((file) => file.ref),
    NOTHING_CHANGED,
  );
  ledger.commit();
  const asks = open.flatMap((file) =>
    file.key === null ? [] : [{ ref: file.ref, key: file.key }],
  );
  return { queued: pending.length + misses.length, asks };
}

/** The answer's `NarrowRun` for group `group` (row 019-49). */
export function narrowAnswer(
  context: SchedulerContext,
  ledger: Ledger,
  group: string,
  selection: Selection,
): NarrowRun {
  const own = selection.selected.get(group) ?? new Set<string>();
  const refOf = (id: string): TestFileRef[] => {
    const file = ledger.files.get(id);
    return file === undefined ? [] : [file.ref];
  };
  const { of, groups } = groupView(context.policy);
  const reached = [...selection.reached].filter(
    (id) => !own.has(id) && refOf(id).some((ref) => of(ref).name === group),
  );
  const others = groups.flatMap(({ name }) => {
    const ids = selection.selected.get(name);
    if (name === group || ids === undefined || ids.size === 0) return [];
    return [{ group: name, files: ids.size, paths: [...(selection.paths.get(name) ?? [])] }];
  });
  return {
    selected: [...own].flatMap(refOf),
    reached: reached.length,
    others,
    unmatched: selection.unmatched,
  };
}
