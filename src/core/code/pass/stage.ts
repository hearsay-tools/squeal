import { setImmediate as nextTurn } from "node:timers/promises";
import type { CodeCheckId, CodeKnownState } from "../../types/code.js";
import type { RelativePath, RevisionNumber, WorktreeId } from "../../types/index.js";
import type { CodeStore } from "../store/index.js";
import type { Entry } from "./blobs.js";
import { type End, report, writeEnd } from "./end.js";
import { type FileAfter, judge } from "./judge.js";
import type { PassContext } from "./pass.js";
import { clearPulled } from "./pulled.js";
import type { PassReport, RecountReason } from "./types.js";

/*
 * Row 015-48: a first count or a recount rebuilds every state of the
 * worktree, 12,630 on 011-197's store, and writing them in the pass's last
 * transaction held the event loop for 437 ms at load 42. Its files are
 * judged and their states staged in parts, each within `PART_BUDGET_MS`
 * and a turn apart, under an id no hook reads. One transaction then makes
 * them the worktree's, so a hook reads the old states or the new ones,
 * never a mix.
 */

/** A part of a quiet pass works this long at most, then gives the event loop a turn. */
export const PART_BUDGET_MS = 25;

/** The files a part reads, judges and stages together. */
export const PART_FILES = 32;

/** The id a quiet pass stages its states under: never a worktree's, which is 16 hex characters. */
export const stagedId = (worktreeId: WorktreeId): WorktreeId => `${worktreeId} recount`;

/** A quiet pass's states, staged, and the checks it removes. */
export interface Staged {
  readonly states: readonly CodeKnownState[];
  readonly removed: readonly CodeCheckId[];
}

/**
 * Reads, judges and stages `entries` in parts, after the staged rows an
 * earlier pass left, as a crash can, are gone. A quiet pass judges each
 * file alone: no move, transition or edit joins two files (D5).
 */
export async function stageQuiet(
  ctx: Pick<PassContext, "store" | "worktreeId" | "counter" | "complexity" | "now">,
  entries: readonly Entry[],
  links: ReadonlySet<string>,
  revision: RevisionNumber,
): Promise<Staged> {
  const { store, worktreeId } = ctx;
  const staged = stagedId(worktreeId);
  // Complexity is the one measure a pass stages.
  store.states.removeMeasure(staged, "complexity");
  const states: CodeKnownState[] = [];
  const removed: CodeCheckId[] = [];
  let began = ctx.now();
  for (let start = 0; start < entries.length; start += PART_FILES) {
    if (start > 0 && ctx.now() - began > PART_BUDGET_MS) {
      await nextTurn();
      began = ctx.now();
    }
    const part = entries.slice(start, start + PART_FILES);
    const after: FileAfter[] = part.map((e) => ({
      path: e.path,
      count:
        e.kind === "count" && !links.has(e.path)
          ? store.counts.get(e.file.hash, e.language, ctx.counter.version)
          : null,
    }));
    const judged = judge({
      worktreeId,
      revision,
      threshold: ctx.complexity.threshold,
      at: ctx.now(),
      quiet: true,
      before: store.states.list(worktreeId, {
        measure: "complexity",
        paths: part.map((e) => e.path),
      }),
      bodies: new Map(),
      after,
    });
    store.transaction(() =>
      store.states.upsertMany(judged.states.map((s) => ({ ...s, worktreeId: staged }))),
    );
    states.push(...judged.states);
    removed.push(...judged.removed);
  }
  return { states, removed };
}

/**
 * Inside the pass's last transaction: the staged states become the
 * worktree's. A prune between two parts takes staged rows, as their id is
 * no live worktree's; then the whole set is written here the old way.
 */
export function adoptStaged(store: CodeStore, worktreeId: WorktreeId, staged: Staged): void {
  const written = store.states.adopt(
    worktreeId,
    stagedId(worktreeId),
    "complexity",
    staged.removed,
  );
  if (written !== staged.states.length) store.states.upsertMany(staged.states);
}

/** The staged rows, a turn after they were adopted. */
export async function dropStaged(store: CodeStore, worktreeId: WorktreeId): Promise<void> {
  await nextTurn();
  store.states.removeMeasure(stagedId(worktreeId), "complexity");
}

/**
 * Row 015-48: a first count's or a recount's states, judged and staged in
 * parts, then adopted in the last transaction with its meta. A failed count
 * keeps its path's states; a symlink's go.
 */
export async function quietEnd(
  ctx: PassContext,
  end: End & { readonly reason: RecountReason },
  entries: readonly Entry[],
  {
    skipped,
    links,
  }: { readonly skipped: ReadonlySet<RelativePath>; readonly links: Set<RelativePath> },
): Promise<PassReport> {
  const { store, worktreeId } = ctx;
  const judged = entries.filter((e) => !skipped.has(e.path));
  // A path judged, gone or too big has no failed count to retry (row 015-18).
  for (const e of judged) end.failed.delete(e.path);
  const staged = await stageQuiet(ctx, judged, links, end.latest);
  const done = store.transaction(() => {
    store.files.removeMany(worktreeId, [...links]);
    adoptStaged(store, worktreeId, staged);
    clearPulled(store.meta, worktreeId);
    writeEnd(ctx, end);
    return report(end.latest, end.reason, entries.length, end.counted, {
      ...{ moves: [], transitions: [], edited: [] },
      removed: staged.removed,
    });
  });
  await dropStaged(store, worktreeId);
  return done;
}
