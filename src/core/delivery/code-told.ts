import { type FailedCount, readUncountable, uncountableFiles } from "../code/pass/failed.js";
import { readTooBigEdits } from "../code/pass/too-big.js";
import type { CodeStore } from "../code/store/types.js";
import { compare } from "../fs/index.js";
import type { CodeFile, CodeKnownState, CodeMeasure } from "../types/code.js";
import { CODE_NOT_JUDGED_MAX, type CodeNews } from "../types/code-delivery.js";
import type { Consumer, Policy, RevisionNumber, WorktreeId } from "../types/index.js";
import { coverageMeasures } from "./code-coverage.js";
import { type CodeBound, codeKey, isOwn } from "./code-delta.js";

/*
 * Row 015-27 (the human, 2026-10-24): the functions a session was told of
 * in full, as a FAIL or a STILL FAIL, that are over now. Test news ends
 * with their number, and `squeal code --told` lists them, from this one
 * read so the two agree. A function a view holds by count (over since
 * before the session, or past the listed limit) is not among them. Row
 * 015-40: the `crap` and `uncovered` states too, each measure counted apart.
 * Row 015-49: the files the session changed that are not judged, the same way.
 */

/** The failing states of `measures` in `worktreeId` that any of `consumers` was told of in full. */
export function toldOver(
  store: CodeStore,
  worktreeId: WorktreeId,
  consumers: readonly Consumer[],
  measures: readonly CodeMeasure[] = ["complexity"],
): CodeKnownState[] {
  const told = new Set(
    consumers.flatMap((c) =>
      store.views
        .list(c)
        .filter((v) => measures.includes(v.measure) && v.told !== "count")
        .map(codeKey),
    ),
  );
  if (told.size === 0) return [];
  return measures.flatMap((measure) =>
    store.states.list(worktreeId, { measure, outcome: "fail" }).filter((s) => told.has(codeKey(s))),
  );
}

/** A changed file not judged: its row, its edit's revision, and its failure when it could not be counted. */
export interface ChangedNotJudged {
  readonly file: CodeFile;
  readonly revision: RevisionNumber;
  /** `null` for a file over `complexity.maxFileBytes`. */
  readonly failure: FailedCount | null;
}

/**
 * Spec 015 D6, a changed file not judged (row 015-49): each file over the
 * limit or that could not be counted whose last edit is in one of
 * `bounds`' revisions, the newest edit first. The edit is decided by its
 * own revision, which a retry and a recount keep, as for the too-big line
 * (015-39). A file judged again, or gone, has no such record.
 */
export function changedNotJudged(
  store: CodeStore,
  worktreeId: WorktreeId,
  bounds: readonly CodeBound[],
): ChangedNotJudged[] {
  if (bounds.length === 0) return [];
  const own = (revision: RevisionNumber | undefined): revision is RevisionNumber =>
    revision !== undefined && bounds.some((b) => isOwn(b, revision));
  const big = readTooBigEdits(store.meta, worktreeId);
  const failed = readUncountable(store.meta, worktreeId);
  const paths = [
    ...[...big].flatMap(([path, revision]) => (own(revision) ? [path] : [])),
    ...[...failed].flatMap(([path, f]) => (own(f.editedAt) ? [path] : [])),
  ];
  if (paths.length === 0) return [];
  const files = store.files.list(worktreeId, paths);
  const spent = uncountableFiles(store, worktreeId, files);
  return files
    .flatMap((file): ChangedNotJudged[] => {
      if (file.tooBig === true) {
        const revision = big.get(file.path);
        return own(revision) ? [{ file, revision, failure: null }] : [];
      }
      const failure = spent.get(file.path);
      return own(failure?.editedAt) ? [{ file, revision: failure.editedAt, failure }] : [];
    })
    .sort((a, b) => b.revision - a.revision || compare(a.file.path, b.file.path));
}

/** `CodeNews.toldOver` of the failing states `over`, each measure apart. */
function toldOf(
  over: readonly CodeKnownState[],
  threshold: number,
): NonNullable<CodeNews["toldOver"]> {
  const count = over.filter((s) => s.measure === "complexity").length;
  const crap = over.filter((s) => s.measure === "crap");
  const uncovered = over.filter((s) => s.measure === "uncovered").length;
  const [first] = crap;
  return {
    count,
    threshold,
    ...(first?.threshold == null
      ? {}
      : { crap: { count: crap.length, threshold: first.threshold } }),
    ...(uncovered === 0 ? {} : { uncovered }),
  };
}

/** `CodeNews.notJudged` of `changed`: the first `CODE_NOT_JUDGED_MAX`, and the rest by number. */
function notJudgedOf(
  changed: readonly ChangedNotJudged[],
  limit: number,
): NonNullable<CodeNews["notJudged"]> {
  return {
    files: changed
      .slice(0, CODE_NOT_JUDGED_MAX)
      .map(({ file, failure }) =>
        failure === null
          ? { path: file.path, reason: "too-big", size: file.size, limit }
          : { path: file.path, reason: "could-not-count" },
      ),
    more: Math.max(0, changed.length - CODE_NOT_JUDGED_MAX),
  };
}

/**
 * `news` with `consumer`'s functions told over (`CodeNews.toldOver`) and
 * the files its own edits in `since` changed that are not judged
 * (`CodeNews.notJudged`), when there are any. No file is the consumer's
 * while no registration is recorded (`since` `null`).
 */
export function withToldOver(
  store: CodeStore,
  consumer: Consumer,
  news: CodeNews | null,
  { threshold, maxFileBytes }: Pick<Policy["complexity"], "threshold" | "maxFileBytes">,
  since: CodeBound | null,
): CodeNews | null {
  const { worktreeId } = consumer;
  const measures = ["complexity", ...coverageMeasures(store, worktreeId)] as const;
  const over = toldOver(store, worktreeId, [consumer], measures);
  const changed = changedNotJudged(store, worktreeId, since === null ? [] : [since]);
  if (over.length === 0 && changed.length === 0) return news;
  return {
    ...(news ?? { v: 1, entries: [], more: 0 }),
    ...(over.length === 0 ? {} : { toldOver: toldOf(over, threshold) }),
    ...(changed.length === 0 ? {} : { notJudged: notJudgedOf(changed, maxFileBytes) }),
  };
}
