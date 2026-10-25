import { compare } from "../../fs/index.js";
import type { RelativePath, RevisionNumber } from "../../types/index.js";
import type { Entry } from "./blobs.js";
import { type FailedCounts, seedsQuietly } from "./failed.js";
import { includedSet } from "./included.js";
import { heldPaths, holdUnlisted, type Listing } from "./listed.js";
import type { PassContext } from "./pass.js";

/*
 * Spec 015 D1 and D4: what one pass reads, each path classified by D1, and
 * the paths it judges with no transition.
 */

/**
 * `plan`'s entries without the files that wait for their listing, and the
 * files an earlier pass held that this one reads again (row 015-52).
 */
export function workEntries(
  ctx: PassContext,
  since: RevisionNumber | null,
  latest: RevisionNumber,
  due: readonly RelativePath[],
  listing: Listing,
) {
  const { store, source, worktreeId } = ctx;
  const released = new Set(
    since === null ? [] : heldPaths(store, worktreeId, source, listing.seen, latest),
  );
  const work = since === null ? null : workSet(ctx, since, latest, due, listing.tests, released);
  const planned = plan(ctx, listing.tests, work);
  return { ...holdUnlisted(store, worktreeId, source, planned, listing, latest), released };
}

/**
 * The edit pass's paths: the revisions' changes, the retries, the failed
 * counts due again (`due`), counted files a runner now lists, and the files
 * an earlier pass held for their listing (row 015-52).
 */
function workSet(
  ctx: PassContext,
  after: RevisionNumber,
  upTo: RevisionNumber,
  due: readonly RelativePath[],
  tests: readonly RelativePath[],
  held: ReadonlySet<RelativePath>,
): RelativePath[] {
  const counted = ctx.store.files.list(ctx.worktreeId, tests);
  return [
    ...new Set([
      ...ctx.source.changedPaths(after, upTo),
      ...ctx.retry,
      ...due,
      ...counted.map((f) => f.path),
      ...held,
    ]),
  ];
}

/**
 * The paths judged with no transition: B1, a count a first count or
 * recount failed on, seeds as that count would have; row 015-52, a counted
 * file that a runner now lists leaves quietly.
 */
export function quietPaths(
  entries: readonly Entry[],
  failed: FailedCounts,
  { tests }: Listing,
): Set<RelativePath> {
  const listed = new Set(tests);
  return new Set(
    entries.flatMap((e) => {
      if (e.kind === "gone") return listed.has(e.path) ? [e.path] : [];
      return e.kind === "count" && seedsQuietly(failed, e.path, e.file.hash) ? [e.path] : [];
    }),
  );
}

/** Each path classified by D1; `paths` `null` for every file Squeal sees and every stored row. */
function plan(
  ctx: PassContext,
  tests: readonly RelativePath[],
  paths: readonly RelativePath[] | null,
): Entry[] {
  const { store, source, worktreeId, complexity } = ctx;
  const included = includedSet(complexity, tests, source.ignored());
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
