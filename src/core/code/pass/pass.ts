import { compare } from "../../fs/index.js";
import type { ObjectFormat } from "../../hash/index.js";
import type { CodeFile } from "../../types/code.js";
import type {
  AbsolutePath,
  EpochMs,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import { removedFailures } from "../crap/removed.js";
import type { CodeStore } from "../store/index.js";
import { countMissing, type Entry } from "./blobs.js";
import {
  cursorOf,
  readCursor,
  recountReason,
  takeAwaited,
  writeCursor,
  writeRecount,
} from "./cursor.js";
import {
  dueRetries,
  type FailedCounts,
  readUncountable,
  seedsQuietly,
  spentFailure,
  writeUncountable,
} from "./failed.js";
import { committedPaths } from "./head.js";
import { includedSet } from "./included.js";
import { checkKey, type FileAfter, judge } from "./judge.js";
import type { Counter, PassReport, PassSource, RecountReason } from "./types.js";

export interface PassContext {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
  readonly store: CodeStore;
  readonly source: PassSource;
  readonly counter: Counter;
  readonly complexity: Policy["complexity"];
  /** The policy was off earlier in this daemon's life: a first count whatever the cursor says. */
  readonly switchedOn: boolean;
  /** Paths whose bytes no longer had the stat cache's hash; read again at the next pass. */
  readonly retry: Set<RelativePath>;
  readonly now: () => EpochMs;
  readonly log: (text: string) => void;
  readonly sliceFiles?: number;
}

/**
 * One pass of spec 015 D4 over a worktree, `null` when nothing is due. With
 * the cursor's policy and counter, it follows the revisions since the
 * cursor: their changed paths, a retry, a failed count due again (row
 * 015-18), and a file a runner now lists. Else it rebuilds every state
 * with no transition (D5) and writes the recount record. Three writes: the files rows, so status can say "counting, N of
 * M"; the blobs no worktree counted yet, in slices with a turn of the event
 * loop between them; then states, transitions, edits and the cursor in one
 * transaction, so a hook never reads half a revision. Before the last, a
 * revision that moved `HEAD` asks git which files are the committed ones
 * (015-19).
 */
export async function runPass(ctx: PassContext): Promise<PassReport | null> {
  const { store, source, worktreeId } = ctx;
  const latest = source.latestRevision();
  const cursor = readCursor(store.meta, worktreeId);
  const current = cursorOf(latest, ctx.complexity, ctx.counter.version);
  const reason = ctx.switchedOn ? "first" : recountReason(cursor, current);
  const started = ctx.now();
  const failed = readUncountable(store.meta, worktreeId);
  const due = retriesDue(ctx, failed, started);
  if (reason === null && cursor?.revision === latest && ctx.retry.size === 0 && due.length === 0) {
    return null;
  }
  const since = reason === null && cursor !== null ? cursor.revision : null;
  const entries = plan(ctx, since === null ? null : workSet(ctx, since, latest, due));
  ctx.retry.clear();
  const bodies =
    reason === null ? oldBodies(store, worktreeId, entries, ctx.counter.version) : new Map();

  store.transaction(() => {
    store.files.removeMany(
      worktreeId,
      entries.filter((e) => e.kind === "gone").map((e) => e.path),
    );
    store.files.upsertMany(worktreeId, filesRows(entries, ctx.counter.version, latest));
  });
  const quiet = reason !== null;
  const { counted, skipped, links } = await countMissing(ctx, entries, failed, {
    now: started,
    quiet,
    threshold: ctx.complexity.threshold,
  });
  // B1: a count a first count or recount failed on seeds as that count would have.
  const seeds = new Set(
    entries.flatMap((e) =>
      e.kind === "count" && seedsQuietly(failed, e.path, e.file.hash) ? [e.path] : [],
    ),
  );
  const after: FileAfter[] = entries
    .filter((e) => !skipped.has(e.path))
    .map((e) => {
      // 015-31: an edit whose count failed is judged under its own threshold too.
      const editedUnder = failed.get(e.path)?.threshold;
      return {
        path: e.path,
        count:
          e.kind === "count" && !links.has(e.path)
            ? store.counts.get(e.file.hash, e.language, ctx.counter.version)
            : null,
        ...(seeds.has(e.path) ? { quiet: true } : {}),
        ...(editedUnder === undefined ? {} : { editedUnder }),
      };
    });
  // A path judged, gone or too big has no failed count to retry (row 015-18).
  for (const e of entries) if (!skipped.has(e.path)) failed.delete(e.path);

  const committed =
    since === null
      ? new Set<RelativePath>()
      : await committedPaths(
          ctx,
          since,
          latest,
          after.flatMap((a) => (a.count === null ? [] : [{ path: a.path, blob: a.count.blob }])),
        );
  return store.transaction(() => {
    store.files.removeMany(worktreeId, [...links]);
    const paths = new Set(after.map((a) => a.path));
    const before = store.states
      .list(worktreeId, { measure: "complexity", ...(quiet ? {} : { paths: [...paths] }) })
      .filter((s) => paths.has(s.check.path));
    const at = ctx.now();
    const judged = judge({
      worktreeId,
      revision: latest,
      threshold: ctx.complexity.threshold,
      at,
      quiet,
      before,
      bodies,
      after,
    });
    for (const { from, to } of judged.moves) store.states.move(worktreeId, from, to);
    // D9's measures go with the function, a failing one resolved (row 015-12).
    if (!quiet) {
      const told = judged.removed.filter((check) => !seeds.has(check.path));
      store.transitions.append(removedFailures(store, worktreeId, told, latest, at));
    }
    store.states.removeMany(worktreeId, judged.removed);
    store.states.upsertMany(judged.states);
    store.transitions.append(judged.transitions);
    // D6's last rule: the delivery tells a standing failure's first edit in a session once.
    // A body a move of `HEAD` brought is not the agent's edit (015-19).
    const edited = judged.edited.filter((check) => !committed.has(check.path));
    store.states.markEdited(
      worktreeId,
      edited.map((check) => ({ check, measure: "complexity", revision: latest, at })),
    );
    writeCursor(store.meta, worktreeId, current);
    writeUncountable(store.meta, worktreeId, failed);
    // The coordinator's contract with 015-07: a first pass over inherited counts writes none,
    // unless a consumer registered before it and was told counting (015-35).
    const awaited = reason === "first" && takeAwaited(store.meta, worktreeId);
    if (reason !== null && (reason !== "first" || counted > 0 || ctx.switchedOn || awaited)) {
      writeRecount(store.meta, worktreeId, {
        revision: latest,
        at: ctx.now(),
        reason,
        threshold: ctx.complexity.threshold,
      });
    }
    return report(latest, reason, entries.length, counted, { ...judged, edited });
  });
}

/**
 * Row 015-18: the failed counts due again. A retry whose time came, and a
 * spent one whose blob a pass has counted since, as another worktree's may.
 */
function retriesDue(ctx: PassContext, failed: FailedCounts, now: EpochMs): RelativePath[] {
  const spent = [...failed].flatMap(([path, f]) => (f.retryAt === null ? [path] : []));
  const counted =
    spent.length === 0
      ? []
      : ctx.store.files
          .list(ctx.worktreeId, spent)
          .filter(
            (f) =>
              spentFailure(failed, f) !== null &&
              ctx.store.counts.get(f.blob, f.language, ctx.counter.version) !== null,
          );
  return [...dueRetries(failed, now), ...counted.map((f) => f.path)];
}

/**
 * The edit pass's paths: the revisions' changes, the retries, the failed
 * counts due again (`due`), and counted files a runner now lists.
 */
function workSet(
  ctx: PassContext,
  after: RevisionNumber,
  upTo: RevisionNumber,
  due: readonly RelativePath[],
): RelativePath[] {
  const tests = ctx.store.files.list(ctx.worktreeId, ctx.source.testFiles());
  return [
    ...new Set([
      ...ctx.source.changedPaths(after, upTo),
      ...ctx.retry,
      ...due,
      ...tests.map((f) => f.path),
    ]),
  ];
}

/** Each path classified by D1; `paths` `null` for every file Squeal sees and every stored row. */
function plan(ctx: PassContext, paths: readonly RelativePath[] | null): Entry[] {
  const { store, source, worktreeId, complexity } = ctx;
  const included = includedSet(complexity, source.testFiles(), source.ignored());
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

function filesRows(
  entries: readonly Entry[],
  counterVersion: number,
  revision: RevisionNumber,
): CodeFile[] {
  return entries.flatMap((e) =>
    e.kind === "gone"
      ? []
      : [
          {
            path: e.path,
            blob: e.file.hash,
            language: e.language,
            counterVersion,
            size: e.file.size,
            revision,
            ...(e.kind === "big" ? { tooBig: true } : {}),
          },
        ],
  );
}

/**
 * D2: each stored check's body hash in the work set, from the count of the
 * blob its state was judged on. Never from the files row's blob: a count the
 * pass skipped or failed leaves that row at a blob no state was judged on.
 */
function oldBodies(
  store: CodeStore,
  worktreeId: WorktreeId,
  entries: readonly Entry[],
  counterVersion: number,
): Map<string, string> {
  const paths = entries.map((e) => e.path);
  const languages = new Map(store.files.list(worktreeId, paths).map((f) => [f.path, f.language]));
  const bodies = new Map<string, string>();
  const read = new Set<string>();
  for (const state of store.states.list(worktreeId, { measure: "complexity", paths })) {
    const { path } = state.check;
    const language = languages.get(path);
    if (language === undefined || read.has(`${path}\0${state.blob}`)) continue;
    read.add(`${path}\0${state.blob}`);
    const count = store.counts.get(state.blob, language, counterVersion);
    for (const fn of count?.functions ?? []) bodies.set(checkKey({ path, ...fn }), fn.bodyHash);
  }
  return bodies;
}

function report(
  revision: RevisionNumber,
  reason: RecountReason | null,
  files: number,
  counted: number,
  judged: ReturnType<typeof judge>,
): PassReport {
  return {
    revision,
    mode: reason ?? "edit",
    files,
    counted,
    transitions: judged.transitions.length,
    moved: judged.moves.length,
    edited: judged.edited,
  };
}
