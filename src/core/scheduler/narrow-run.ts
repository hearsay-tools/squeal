import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath, RevisionNumber } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { AffectedTestFiles } from "../types/runner.js";
import type { NarrowNotRun, NarrowRun, NarrowRunRequest } from "../types/scheduler.js";
import type { CommitAsk } from "./commit-asks.js";
import { NOTHING_CHANGED, type SchedulerContext, tryRunner } from "./context.js";
import { coveredOf } from "./covered-files.js";
import { editWork, fetchEditCut, observedDirectOf } from "./edit-cut.js";
import { classify, type FileState } from "./files.js";
import type { GroupTiers } from "./group-tiers.js";
import type { Ledger } from "./ledger.js";
import type { Request } from "./request-intake-types.js";
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

/** Why a narrow run queues nothing once the install went under the daemon (review 0.1.411, B2). */
export const REINSTALLED_REASON =
  "dependencies were removed under the running daemon (a reinstall)";

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

/** What a narrow run decided under the lock, before its store write. */
interface NarrowPlan {
  /** The worktree's revision when the request was taken. */
  readonly revision: RevisionNumber;
  readonly selection: Selection;
}

/**
 * Spec 019 D6 "Narrow run" (row 019-49) as the request intake takes it (row
 * 011-322): of group `group`, only the test files `paths` select run now
 * (`selectNarrow`), whatever its moment; a current one does not run again.
 * Its lane (of `groups`) runs them as asks at their keys, so the group's
 * other files keep waiting and the group is never made current by it. A
 * source path asks the runner, so the request waits for the runner work
 * before it. `null` for a group the policy in force does not have; rejects
 * for a lint group.
 */
export function narrowRequest(
  group: string,
  paths: readonly RelativePath[],
  groups: GroupTiers,
): Request<NarrowRunRequest | null, NarrowPlan> {
  return {
    operation: `taking a squeal run ${group} <path>... request`,
    start: {
      skip: "no closed answer: once closed its runner-work wait rejects; before the start it throws",
    },
    // Review 0.1.411, B2: the answer says why nothing was queued, of the files it selected.
    installWait: {
      answer: (context, ledger, { revision, selection }, reason, id) => ({
        answer: {
          revision,
          queued: 0,
          narrow: narrowAnswer(context, ledger, group, selection, reason),
          coveredId: id,
        },
        covered: selectedOf(ledger, group, selection),
      }),
    },
    runnerWork: {
      always: async (context, ledger) => {
        const revision = ledger.revision.number;
        const resolved = groupView(context.policy).groups.find((g) => g.name === group);
        if (resolved === undefined) return { answer: null };
        if (resolved.select.kind === "lint") {
          throw new Error(`group ${group} is a lint group, which runs whole: squeal run ${group}`);
        }
        return { plan: { revision, selection: await selectNarrow(context, ledger, paths) } };
      },
    },
    store: {
      stage: (context, ledger, { revision, selection }, id) => {
        const selected = selection.selected.get(group) ?? new Set<string>();
        const { queued, asks } = queueNarrow(ledger, selected);
        groups.lanes(context.policy);
        groups.get(group)?.narrow.add(asks, ledger);
        // Review 0.1.411, B2: the answer says which selected files are current, after queuing.
        const narrow = narrowAnswer(context, ledger, group, selection, null);
        const covered = selectedOf(ledger, group, selection);
        return { answer: { revision, queued, narrow, coveredId: id }, covered };
      },
    },
    wake: { lane: group },
  };
}

/** Group `group`'s selected files, a narrow run's covered files. */
function selectedOf(ledger: Ledger, group: string, selection: Selection): FileState[] {
  const selected = selection.selected.get(group) ?? new Set<string>();
  return [...selected].flatMap((id) => ledger.files.get(id) ?? []);
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

/**
 * The answer's `NarrowRun` for group `group` (row 019-49), once its selected
 * files are queued. `waiting` is why nothing was queued (no install, or a
 * reinstall), else `null`.
 */
export function narrowAnswer(
  context: SchedulerContext,
  ledger: Ledger,
  group: string,
  selection: Selection,
  waiting: string | null,
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
  const files = [...own].flatMap((id) => ledger.files.get(id) ?? []);
  return {
    selected: files.map((file) => file.ref),
    reached: reached.length,
    others,
    unmatched: selection.unmatched,
    current: files.filter((file) => classify(file) === "current").length,
    notRun: files.flatMap((file) => notRunOf(file, waiting)),
  };
}

/**
 * Review 0.1.411, B2: a selected file that is neither current nor queued,
 * with why, as its covered-files record says it (`coveredOf`, row
 * 011-325); `[]` for one that is.
 */
function notRunOf(file: FileState, waiting: string | null): NarrowNotRun[] {
  const covered = coveredOf(file, waiting);
  return covered.state === "not-queued" ? [{ testFile: file.ref, reason: covered.reason }] : [];
}
