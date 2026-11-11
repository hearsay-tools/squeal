import { compare } from "../../fs/compare.js";
import type { RelativePath, RevisionNumber } from "../../types/common.js";
import type { Entry } from "./blobs.js";
import { type FailedCounts, seedsQuietly } from "./failed.js";
import { includedSet } from "./included.js";
import type { PassContext } from "./pass.js";

/*
 * Spec 015 D1 and D4: what one pass reads, each path classified by D1, and
 * the paths it judges with no transition. Spec 020 D11.6: a test file is
 * counted like any other, so no file waits for a runner listing.
 */

/**
 * The pass's entries: with `since`, the edit pass's paths, else every file
 * Squeal sees and every stored row.
 */
export function workEntries(
  ctx: PassContext,
  since: RevisionNumber | null,
  latest: RevisionNumber,
  due: readonly RelativePath[],
): Entry[] {
  return plan(ctx, since === null ? null : workSet(ctx, since, latest, due));
}

/** The edit pass's paths: the revisions' changes, the retries and the failed counts due again (`due`). */
function workSet(
  ctx: PassContext,
  after: RevisionNumber,
  upTo: RevisionNumber,
  due: readonly RelativePath[],
): RelativePath[] {
  return [...new Set([...ctx.source.changedPaths(after, upTo), ...ctx.retry, ...due])];
}

/**
 * The paths judged with no transition (B1): a count a first count or
 * recount failed on seeds as that count would have.
 */
export function quietPaths(entries: readonly Entry[], failed: FailedCounts): Set<RelativePath> {
  return new Set(
    entries.flatMap((e) =>
      e.kind === "count" && seedsQuietly(failed, e.path, e.file.hash) ? [e.path] : [],
    ),
  );
}

/** Each path classified by D1; `paths` `null` for every file Squeal sees and every stored row. */
function plan(ctx: PassContext, paths: readonly RelativePath[] | null): Entry[] {
  const { store, source, worktreeId, complexity } = ctx;
  const included = includedSet(complexity, source.ignored());
  const all = paths === null ? new Map(source.files().map((f) => [f.path, f])) : null;
  const listed =
    all === null
      ? (paths ?? [])
      : [...new Set([...all.keys(), ...store.files.list(worktreeId).map((f) => f.path)])];
  const entries = [...listed].sort(compare).map((path): Entry => {
    const language = included(path);
    const file = language === null ? null : all === null ? source.file(path) : all.get(path);
    if (language === null || file === null || file === undefined) return { kind: "gone", path };
    return { kind: file.size > complexity.maxFileBytes ? "big" : "count", path, file, language };
  });
  // A gone path the store never counted is nothing to remove.
  const gone = entries.filter((e) => e.kind === "gone").map((e) => e.path);
  const stored = new Set(store.files.list(worktreeId, gone).map((f) => f.path));
  return entries.filter((e) => e.kind !== "gone" || stored.has(e.path));
}
