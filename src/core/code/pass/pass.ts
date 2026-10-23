import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { compare } from "../../fs/index.js";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { CodeFile, CodeLanguage, FileCount } from "../../types/code.js";
import type {
  AbsolutePath,
  EpochMs,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { CodeStore } from "../store/index.js";
import { cursorOf, readCursor, recountReason, writeCursor, writeRecount } from "./cursor.js";
import { includedSet } from "./included.js";
import { checkKey, type FileAfter, judge } from "./judge.js";
import type { Counter, PassReport, PassSource, RecountReason, SourceFile } from "./types.js";

/** Spec 015 D4: blobs counted per slice; the daemon serves requests and starts tiers between slices. */
export const SLICE_FILES = 200;

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

/** A work set path still included: over the size limit, or to count. */
interface FileEntry {
  readonly kind: "big" | "count";
  readonly path: RelativePath;
  readonly file: SourceFile;
  readonly language: CodeLanguage;
}

/** A work set path: no longer counted, or a file. */
type Entry = { readonly kind: "gone"; readonly path: RelativePath } | FileEntry;

/**
 * One pass of spec 015 D4 over a worktree, `null` when nothing is due. With
 * the cursor's policy and counter, it follows the revisions since the
 * cursor: their changed paths, a retry, and a file a runner now lists. Else
 * it rebuilds every state with no transition (D5) and writes the recount
 * record. Four steps: the files rows, so status can say "counting, N of M";
 * the blobs no worktree counted yet, in slices with a turn of the event loop
 * between them; then states, transitions and the cursor in one transaction,
 * so a hook never reads half a revision.
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
  const bodies = reason === null ? oldBodies(store, worktreeId, entries) : new Map();

  store.transaction(() => {
    store.files.removeMany(
      worktreeId,
      entries.filter((e) => e.kind === "gone").map((e) => e.path),
    );
    store.files.upsertMany(worktreeId, filesRows(entries, ctx.counter.version, latest));
  });
  const { counted, skipped } = await countMissing(ctx, entries);

  const quiet = reason !== null;
  const after: FileAfter[] = entries
    .filter((e) => !skipped.has(e.path))
    .map((e) => ({
      path: e.path,
      count:
        e.kind === "count" ? store.counts.get(e.file.hash, e.language, ctx.counter.version) : null,
    }));
  return store.transaction(() => {
    const paths = new Set(after.map((a) => a.path));
    const before = store.states
      .list(worktreeId, { measure: "complexity", ...(quiet ? {} : { paths: [...paths] }) })
      .filter((s) => paths.has(s.check.path));
    const judged = judge({
      worktreeId,
      revision: latest,
      threshold: ctx.complexity.threshold,
      at: ctx.now(),
      quiet,
      before,
      bodies,
      after,
    });
    for (const { from, to } of judged.moves) store.states.move(worktreeId, from, to);
    store.states.removeMany(worktreeId, judged.removed);
    store.states.upsertMany(judged.states);
    store.transitions.append(judged.transitions);
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

/** D2: each stored check's body hash in the work set, from the count its files row names. */
function oldBodies(
  store: CodeStore,
  worktreeId: WorktreeId,
  entries: readonly Entry[],
): Map<string, string> {
  const bodies = new Map<string, string>();
  const rows = store.files.list(
    worktreeId,
    entries.map((e) => e.path),
  );
  for (const row of rows) {
    const count = store.counts.get(row.blob, row.language, row.counterVersion);
    for (const fn of count?.functions ?? []) {
      bodies.set(checkKey({ path: row.path, ...fn }), fn.bodyHash);
    }
  }
  return bodies;
}

/**
 * D4's blob lookup and slices: each blob of the work set with no count at
 * this counter version is read and counted once, `sliceFiles` at a time, and
 * stored with one transaction per slice. A blob the disk no longer holds is retried at the next pass; one
 * the counter fails on stays uncounted (`pending`). The paths of either keep
 * their states as they were.
 */
async function countMissing(
  ctx: PassContext,
  entries: readonly Entry[],
): Promise<{ counted: number; skipped: Set<RelativePath> }> {
  const { store, counter } = ctx;
  const byBlob = new Map<string, FileEntry[]>();
  for (const e of entries) {
    if (e.kind !== "count") continue;
    const key = `${e.file.hash}\0${e.language}`;
    byBlob.set(key, [...(byBlob.get(key) ?? []), e]);
  }
  const missing = [...byBlob.values()].filter(
    ([e]) => e !== undefined && store.counts.get(e.file.hash, e.language, counter.version) === null,
  );
  const skipped = new Set<RelativePath>();
  let counted = 0;
  const size = ctx.sliceFiles ?? SLICE_FILES;
  for (let start = 0; start < missing.length; start += size) {
    if (start > 0) await nextTurn();
    const slice = missing.slice(start, start + size);
    // One file at a time: each read gives the event loop a turn, so no stretch holds more than one count.
    const counts: (FileCount | "moved" | null)[] = [];
    for (const [e] of slice) counts.push(e === undefined ? null : await countOne(ctx, e));
    store.transaction(() => {
      slice.forEach((group, i) => {
        const count = counts[i];
        if (count === "moved") for (const e of group) ctx.retry.add(e.path);
        if (count === undefined || count === null || count === "moved") {
          for (const e of group) skipped.add(e.path);
          return;
        }
        store.counts.put(count, ctx.now());
        counted++;
      });
    });
  }
  return { counted, skipped };
}

const decoder = new TextDecoder();

async function countOne(ctx: PassContext, e: FileEntry): Promise<FileCount | "moved" | null> {
  const bytes = await readFile(join(ctx.root, e.path)).catch(() => null);
  if (bytes === null || blobHash(bytes, ctx.format) !== e.file.hash) return "moved";
  try {
    const { functions, errors } = await ctx.counter.count(decoder.decode(bytes), e.language);
    return {
      blob: e.file.hash,
      language: e.language,
      counterVersion: ctx.counter.version,
      functions,
      errors,
    };
  } catch (error) {
    ctx.log(`complexity: could not count ${e.path}: ${String(error)}`);
    return null;
  }
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
