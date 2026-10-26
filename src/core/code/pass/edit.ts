import type { CodeLanguage } from "../../types/code.js";
import type { RelativePath } from "../../types/index.js";
import { moveChecks } from "../crap/checks.js";
import { removedFailures } from "../crap/removed.js";
import type { Entry } from "./blobs.js";
import { type End, report, writeEnd } from "./end.js";
import type { FailedCounts } from "./failed.js";
import { type FileAfter, judge } from "./judge.js";
import { holdRemovals, type ListedRecord } from "./listed.js";
import type { PassContext } from "./pass.js";
import { writePulled } from "./pulled.js";
import type { PassReport } from "./types.js";

/* Spec 015 D2, D5 and D6: what an edit pass judges, and its last transaction. */

/** One file an edit pass judges: what `judge` reads beside its count, read in its part. */
export type EditFile = Omit<FileAfter, "count"> & {
  readonly count: () => FileAfter["count"];
};

/** What the pass knew before its parts. */
export interface EditPlan {
  readonly files: readonly EditFile[];
  /** Every path of the work set: the pulled record's. */
  readonly paths: ReadonlySet<RelativePath>;
  /** Each path's language in its files row before the pass. */
  readonly languages: ReadonlyMap<RelativePath, CodeLanguage>;
  readonly links: ReadonlySet<RelativePath>;
  /** Paths git brought (015-19): no edit marked. */
  readonly committed: ReadonlySet<RelativePath>;
  /** Paths judged with no transition (`quietPaths`). */
  readonly seeds: ReadonlySet<RelativePath>;
  /** Files still waiting for their listing: the removals wait too (row 015-52). */
  readonly held: number;
  readonly entries: number;
  readonly listed: (deferred: readonly RelativePath[]) => ListedRecord;
}

/**
 * The files an edit pass judges: every path of `entries` but the `skipped`,
 * each with the threshold of its failed edit (015-31). A path judged, gone
 * or too big has no failed count to retry, so it leaves `failed` (row
 * 015-18).
 */
export function judgedFiles(
  ctx: PassContext,
  entries: readonly Entry[],
  {
    skipped,
    links,
    failed,
    seeds,
  }: {
    readonly skipped: ReadonlySet<RelativePath>;
    readonly links: ReadonlySet<RelativePath>;
    readonly failed: FailedCounts;
    readonly seeds: ReadonlySet<RelativePath>;
  },
): EditFile[] {
  const files = entries
    .filter((e) => !skipped.has(e.path))
    .map((e): EditFile => {
      const editedUnder = failed.get(e.path)?.threshold;
      return {
        path: e.path,
        count: () =>
          e.kind === "count" && !links.has(e.path)
            ? ctx.store.counts.get(e.file.hash, e.language, ctx.counter.version)
            : null,
        ...(seeds.has(e.path) ? { quiet: true } : {}),
        ...(editedUnder === undefined ? {} : { editedUnder }),
      };
    });
  for (const f of files) failed.delete(f.path);
  return files;
}

/**
 * An edit pass of one part: it reads, judges and writes its states,
 * transitions, edits, pulled record and meta in one transaction, so a hook
 * never reads half a revision. `bodies` are its checks' old body hashes.
 */
export function editEnd(
  ctx: PassContext,
  end: Omit<End, "listed">,
  plan: EditPlan,
  bodies: ReadonlyMap<string, string>,
): PassReport {
  const { store, worktreeId } = ctx;
  const { latest } = end;
  const after: FileAfter[] = plan.files.map(({ count, ...file }) => ({ ...file, count: count() }));
  return store.transaction(() => {
    store.files.removeMany(worktreeId, [...plan.links]);
    const before = store.states.list(worktreeId, { measure: "complexity", paths: [...plan.paths] });
    const at = ctx.now();
    const { judged, deferred } = holdRemovals(
      judge({
        worktreeId,
        revision: latest,
        threshold: ctx.complexity.threshold,
        at,
        quiet: false,
        before,
        bodies,
        after,
      }),
      plan.held > 0,
      plan.seeds,
    );
    moveChecks(store, worktreeId, judged.moves, ctx.coverageExcluded);
    // D9's measures go with the function, a failing one resolved (row 015-12).
    const told = judged.removed.filter((check) => !plan.seeds.has(check.path));
    store.transitions.append(removedFailures(store, worktreeId, told, latest, at));
    store.states.removeMany(worktreeId, judged.removed);
    store.states.upsertMany(judged.states);
    store.transitions.append(judged.transitions);
    // D6's last rule: the delivery tells a standing failure's first edit in a session once.
    // A body a move of `HEAD` brought is not the agent's edit (015-19).
    const edited = judged.edited.filter((check) => !plan.committed.has(check.path));
    store.states.markEdited(
      worktreeId,
      edited.map((check) => ({ check, measure: "complexity", revision: latest, at })),
    );
    // 015-38: the files git changed last, whose PASS or RESOLVED a session told by count is not told.
    writePulled(store.meta, worktreeId, latest, plan.paths, plan.committed);
    writeEnd(ctx, { ...end, listed: plan.listed(deferred) });
    return report(latest, null, plan.entries, end.counted, { ...judged, edited });
  });
}
