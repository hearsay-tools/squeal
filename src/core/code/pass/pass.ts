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
import type { CodeStore } from "../store/index.js";
import { countMissing, type Entry } from "./blobs.js";
import { cursorOf, readCursor, recountReason, writeCursor, writeRecount } from "./cursor.js";
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
 * cursor: their changed paths, a retry, and a file a runner now lists. Else
 * it rebuilds every state with no transition (D5) and writes the recount
 * record. Three writes: the files rows, so status can say "counting, N of
 * M"; the blobs no worktree counted yet, in slices with a turn of the event
 * loop between them; then states, transitions, edits and the cursor in one
 * transaction, so a hook never reads half a revision.
 */
export async function runPass(ctx: PassContext): Promise<PassReport | null> {
  const { store, source, worktreeId } = ctx;
  const latest = source.latestRevision();
  const cursor = readCursor(store.meta, worktreeId);
  const current = cursorOf(latest, ctx.complexity, ctx.counter.version);
  const reason = ctx.switchedOn ? "first" : recountReason(cursor, current);
  if (reason === null && cursor?.revision === latest && ctx.retry.size === 0) return null;
  const since = reason === null && cursor !== null ? cursor.revision : null;
  const entries = plan(ctx, since === null ? null : workSet(ctx, since, latest));
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
  const { counted, skipped, links } = await countMissing(ctx, entries);

  const quiet = reason !== null;
  const after: FileAfter[] = entries
    .filter((e) => !skipped.has(e.path))
    .map((e) => ({
      path: e.path,
      count:
        e.kind === "count" && !links.has(e.path)
          ? store.counts.get(e.file.hash, e.language, ctx.counter.version)
          : null,
    }));
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
    store.states.removeMany(worktreeId, judged.removed);
    store.states.upsertMany(judged.states);
    store.transitions.append(judged.transitions);
    // D6's last rule: the delivery tells a standing failure's first edit in a session once.
    store.states.markEdited(
      worktreeId,
      judged.edited.map((check) => ({ check, measure: "complexity", revision: latest, at })),
    );
    writeCursor(store.meta, worktreeId, current);
    // The coordinator's contract with 015-07: a first pass over inherited counts writes none.
    if (reason !== null && (reason !== "first" || counted > 0 || ctx.switchedOn)) {
      writeRecount(store.meta, worktreeId, {
        revision: latest,
        at: ctx.now(),
        reason,
        threshold: ctx.complexity.threshold,
      });
    }
    return report(latest, reason, entries.length, counted, judged);
  });
}

/** The edit pass's paths: the revisions' changes, the retries, and counted files a runner now lists. */
function workSet(ctx: PassContext, after: RevisionNumber, upTo: RevisionNumber): RelativePath[] {
  const tests = ctx.store.files.list(ctx.worktreeId, ctx.source.testFiles());
  return [
    ...new Set([
      ...ctx.source.changedPaths(after, upTo),
      ...ctx.retry,
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
