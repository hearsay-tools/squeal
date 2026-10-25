import { worktreeIdFor } from "../core/fs/index.js";
import { testFileId } from "../core/keys/index.js";
import {
  askNamedRun,
  type RetryEnd,
  type RetryOutcome,
  type RetryRecord,
  readRetries,
  retriesAt,
} from "../core/retry/index.js";
import { fileClassOf } from "../core/state/index.js";
import { checksByFile, claimantOf } from "../core/status/index.js";
import { fromBase } from "../core/status/next-step-text.js";
import { plural, shellWord } from "../core/text.js";
import type {
  AbsolutePath,
  CheckKey,
  EpochMs,
  Store,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";
import type { NamedFile } from "./named-files.js";
import {
  BUSY_BOUND_MS,
  isBusyAnswer,
  openForWrites,
  tellDaemonRetries,
  whileBusy,
} from "./store-writes.js";
import type { FileVerdict } from "./verdict.js";

/*
 * Row 011-207 (gh-82, 011 C15 and 005 D2 as amended 2026-10-25): a named
 * wait asks one run of each test file named by its own path that is stale or
 * unknown at its key with nothing queued, no other worktree's claim of the
 * key and no request ever kept there, as `squeal retry` with no reason
 * does, and holds for it as pending. A source path's selection and every
 * file not named stay lookup-only (the human's hold of 2026-10-20).
 */

/** A file a named wait asks one run of, at the key and in the class it read. */
export interface AskFile {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  readonly state: "stale" | "unknown";
}

/**
 * What one ask got: `queued`, this wait's request; `joined` or `asked`, a
 * request kept at the key since its read (`askNamedRun`); `busy`, the store
 * stayed busy past the bound, so nothing was stored.
 */
export interface AskedRun extends AskFile {
  readonly answer: "queued" | "joined" | "asked" | "busy";
  /** The request it holds for, with `queued` or `joined`. */
  readonly record?: string;
}

/** An asked run as the wait's last read found it (`NamedWait.asked`). */
export interface AskedEnd extends AskedRun {
  /** Its request had not ended. */
  readonly pending: boolean;
  /** Pending with the file not queued at the key yet: the daemon has not taken it. */
  readonly untaken: boolean;
  readonly outcome?: RetryOutcome;
}

/**
 * One asked run in `selection.asked` (row 011-207, additive): whether its
 * request was pending at the last read, else how it ended.
 */
export interface AskedPayload {
  readonly project: string;
  readonly path: string;
  readonly pending: boolean;
  readonly outcome?: RetryOutcome;
}

/** A run as `selection.asked` gives it; only this wait's requests and busy ones are listed. */
export function askedPayload(e: AskedEnd): AskedPayload {
  const { project, path } = e.testFile;
  return {
    project,
    path,
    pending: e.pending,
    ...(e.outcome === undefined ? {} : { outcome: e.outcome }),
  };
}

/** How a named wait stores its asks (`NamedWaitOptions.ask`). */
export type AskNamed = (
  root: AbsolutePath,
  files: readonly AskFile[],
  asker: string,
  withinMs: number,
) => Promise<readonly AskedRun[]>;

/**
 * Of `files`, the selected files named by their own paths, those to ask one
 * run of, from the read whose selection is decided.
 */
export function askableFiles(
  store: Store,
  worktreeId: WorktreeId,
  files: readonly TestFileRef[],
  now: EpochMs,
): AskFile[] {
  if (files.length === 0) return [];
  // Task 011-42: a queued or unkeyed file needs no state read.
  const rows = store.testFileKeys
    .list(worktreeId, files)
    .filter((row) => row.key !== null && row.pending === null);
  if (rows.length === 0) return [];
  const checks = checksByFile(
    store.knownStates.list(
      worktreeId,
      rows.map((r) => r.testFile),
    ),
  );
  let records: readonly RetryRecord[] | undefined;
  return rows.flatMap((row): AskFile[] => {
    const ref = row.testFile;
    const key = row.key as CheckKey;
    const state = fileClassOf(row, checks.get(testFileId(ref)) ?? []);
    if (state !== "stale" && state !== "unknown") return [];
    // C7: another worktree's run of the key stores the result this wait needs.
    if (claimantOf(store, worktreeId, ref, key, now) !== null) return [];
    records ??= readRetries(store);
    return retriesAt(records, ref, key).length > 0 ? [] : [{ testFile: ref, key, state }];
  });
}

/**
 * Stores one request per file as `askNamedRun` decides, each within the
 * busy bound or what is left of the wait, then tells the daemon as `retry`
 * does, so the run need not wait for its next pass. A worktree without a
 * store asks nothing.
 */
export const askNamedRuns: AskNamed = async (root, files, asker, withinMs) => {
  const store = openForWrites(root);
  if (store === null) return files.map((f) => ({ ...f, answer: "busy" }));
  const deadline = (Date.now() + Math.max(1, Math.min(BUSY_BOUND_MS, withinMs))) as EpochMs;
  const worktreeId = worktreeIdFor(root);
  const runs: AskedRun[] = [];
  try {
    for (const file of files) {
      // Its run starts at once whatever the reason; the record keeps one for older readers.
      const ask = { ...file, session: asker, reason: "environment" as const, worktreeId };
      const answer = whileBusy(store, deadline, () =>
        askNamedRun(store, { ...ask, at: Date.now() as EpochMs }),
      );
      runs.push(
        isBusyAnswer(answer)
          ? { ...file, answer: "busy" }
          : { ...file, answer: answer.kind, record: answer.record.id },
      );
    }
  } finally {
    store.close();
  }
  if (runs.some((r) => r.answer === "queued")) await tellDaemonRetries(root);
  return runs;
};

/**
 * The asked runs as a read finds them: a request still pending for a file
 * at the key it was asked at holds the wait, read `pending` once queued and
 * so held as any queued file, `untaken` before. A poll reads the requests
 * only for a file stale or unknown at that key; the last read (`all`)
 * reads them for each. A request kept no more (`RETRIES_KEPT`) has ended.
 */
export function askedEnds(
  store: Store,
  worktreeId: WorktreeId,
  runs: readonly AskedRun[],
  all: boolean,
): readonly AskedEnd[] {
  const held = runs.filter((r) => r.record !== undefined);
  const none = { pending: false, untaken: false } as const;
  if (held.length === 0) return runs.map((r) => ({ ...r, ...none }));
  const refs = held.map((r) => r.testFile);
  const rows = new Map(
    store.testFileKeys.list(worktreeId, refs).map((row) => [testFileId(row.testFile), row]),
  );
  const checks = checksByFile(store.knownStates.list(worktreeId, refs));
  const noResult = new Set(
    held
      .filter((run) => {
        const row = rows.get(testFileId(run.testFile));
        const state = fileClassOf(row, checks.get(testFileId(run.testFile)) ?? []);
        return row?.key === run.key && (state === "stale" || state === "unknown");
      })
      .map((run) => run.record),
  );
  if (!all && noResult.size === 0) return runs.map((r) => ({ ...r, ...none }));
  const records = new Map(readRetries(store).map((r) => [r.id, r]));
  return runs.map((run): AskedEnd => {
    const record = run.record === undefined ? undefined : records.get(run.record);
    if (record === undefined) return { ...run, ...none };
    const pending = record.end === null;
    const end = pending ? {} : { outcome: (record.end as RetryEnd).outcome };
    return { ...run, ...end, pending, untaken: pending && noResult.has(run.record) };
  });
}

/**
 * The asked files the daemon queued since the wait's promotion went, which
 * held none of them (`unpromoted`, emptied as they go): the daemon keeps a
 * promotion only of files queued or running when it comes (011 C15).
 */
export function takenSince(
  unpromoted: Set<string>,
  asked: readonly AskedRun[],
  untaken: readonly AskedEnd[],
): TestFileRef[] {
  if (unpromoted.size === 0) return [];
  const waiting = new Set(untaken.map((e) => testFileId(e.testFile)));
  const taken = asked.filter(
    (r) => unpromoted.has(testFileId(r.testFile)) && !waiting.has(testFileId(r.testFile)),
  );
  for (const r of taken) unpromoted.delete(testFileId(r.testFile));
  return taken.map((r) => r.testFile);
}

/**
 * The wait's files with each untaken asked one read as pending on its own
 * request (the `asked` standing), not as stale or unknown with nothing
 * queued: the wait holds for it.
 */
export function heldAsFiles(
  files: readonly NamedFile[],
  untaken: readonly AskedEnd[],
): readonly NamedFile[] {
  if (untaken.length === 0) return files;
  const ids = new Set(untaken.map((e) => testFileId(e.testFile)));
  return files.map((f) =>
    ids.has(testFileId(f.testFile))
      ? { testFile: f.testFile, state: "pending", standing: { kind: "asked" } }
      : f,
  );
}

/** `verdict` with each untaken asked file counted pending, as `heldAsFiles` reads it. */
export function heldAsVerdict(verdict: FileVerdict, untaken: readonly AskedEnd[]): FileVerdict {
  if (untaken.length === 0) return verdict;
  const byClass = { ...verdict.byClass };
  for (const e of untaken) {
    byClass[e.state] -= 1;
    byClass.pending += 1;
  }
  return { ...verdict, byClass };
}

/**
 * The `Run asked:` line (row 011-207), none when this wait stored no
 * request: each file it asked for, as `retry` would name it from `base`;
 * when a run had not ended at the last read, that it is pending. A busy
 * store's files get a line apart, with the command that asks them.
 */
export function askedLines(
  ends: readonly AskedEnd[] | undefined,
  command: string,
  base?: string,
): string[] {
  const queued = (ends ?? []).filter((e) => e.answer === "queued");
  const busy = (ends ?? []).filter((e) => e.answer === "busy");
  const shown = (of: readonly AskedEnd[]) => of.map((e) => fromBase(base, e.testFile.path));
  const lines: string[] = [];
  if (queued.length > 0) lines.push(`Run asked: ${queuedText(queued, shown(queued), command)}`);
  if (busy.length > 0) {
    const paths = shown(busy);
    const them = busy.length === 1 ? "it" : "them";
    lines.push(
      `Run not asked: ${paths.join(", ")}: the store stayed busy; \`${command} retry ${paths.map(shellWord).join(" ")}\` asks ${them}.`,
    );
  }
  return lines;
}

function queuedText(queued: readonly AskedEnd[], paths: readonly string[], command: string) {
  const pending = queued.filter((e) => e.pending);
  if (queued.length === 1) {
    const [only] = queued as [AskedEnd];
    const [path] = paths as [string];
    const tail = !only.pending
      ? ""
      : only.untaken
        ? "; the run is pending: the daemon has not taken the request yet"
        : "; the run is pending";
    return `${path} was ${only.state} with nothing queued, so this wait asked its one run at these inputs, as \`${command} retry ${shellWord(path)}\` does${tail}.`;
  }
  const states = new Set(queued.map((e) => e.state));
  const were = states.size === 2 ? "stale or unknown" : [...states][0];
  const tail =
    pending.length === 0
      ? ""
      : pending.length === 1
        ? `; 1 run is pending: ${paths[queued.indexOf(pending[0] as AskedEnd)]}`
        : `; ${pending.length} runs are pending: ${pending.map((e) => paths[queued.indexOf(e)]).join(", ")}`;
  return `${plural(queued.length, "test file")} were ${were} with nothing queued, so this wait asked one run of each at these inputs, as \`${command} retry\` does: ${paths.join(", ")}${tail}.`;
}
