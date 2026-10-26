import { testFileId } from "../core/keys/index.js";
import {
  type AskedKey,
  type RetryOutcome,
  type RetryRecord,
  readAskedKeys,
  readRetries,
  storedAt,
} from "../core/retry/index.js";
import { fileClassOf } from "../core/state/index.js";
import { checksByFile, claimantOf } from "../core/status/index.js";
import type {
  CheckKey,
  EpochMs,
  KnownState,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";
import type { NamedFile } from "./named-files.js";
import { waitAsked } from "./status-wait-ask-lines.js";
import type { FileVerdict } from "./verdict.js";

/*
 * Row 011-207 (gh-82, 011 C15 and 005 D2 as amended 2026-10-25): a named
 * wait asks one run of each test file named by its own path that is stale or
 * unknown at its key with nothing queued, no other worktree's claim of the
 * key and no request ever stored there, as `squeal retry` with no reason
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
 * request kept at the key since its read (`askNamedRun`); `changed`, the
 * file no longer qualifies (review 0.1.322 B1); `busy`, the store stayed
 * busy past the bound. Only `queued` and `joined` stored or hold a request.
 */
export interface AskedRun extends AskFile {
  readonly answer: "queued" | "joined" | "asked" | "changed" | "busy";
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
 * Of `files`, the selected files named by their own paths, those to ask one
 * run of, from the read whose selection is decided.
 */
function askableFiles(
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
  let asked: readonly AskedKey[] | undefined;
  return rows.flatMap((row): AskFile[] => {
    const ref = row.testFile;
    const state = askableState(store, worktreeId, row, checks.get(testFileId(ref)) ?? [], now);
    if (state === null) return [];
    records ??= readRetries(store);
    asked ??= readAskedKeys(store);
    const key = row.key as CheckKey;
    return storedAt(records, asked, ref, key) ? [] : [{ testFile: ref, key, state }];
  });
}

/**
 * `row`'s class when a wait may ask its run: keyed, nothing queued, stale or
 * unknown, and no other worktree's run of its key (C7), which stores the
 * result this wait needs; else `null`.
 */
export function askableState(
  store: Store,
  worktreeId: WorktreeId,
  row: TestFileKeyRecord,
  own: readonly KnownState[],
  now: EpochMs,
): AskFile["state"] | null {
  if (row.key === null || row.pending !== null) return null;
  const state = fileClassOf(row, own);
  if (state !== "stale" && state !== "unknown") return null;
  return claimantOf(store, worktreeId, row.testFile, row.key, now) === null ? state : null;
}

/**
 * The asked runs as a read finds them: a request still pending for a file
 * at the key it was asked at holds the wait, read `pending` once queued and
 * so held as any queued file, `untaken` before. A poll reads the requests
 * only for a file stale or unknown at that key; the last read (`all`)
 * reads them for each. A request the row keeps no more is pending, never
 * ended (review 0.1.322 B2): this release drops no pending request at a
 * held key, but an older writer drops the oldest whatever it is.
 */
function askedEnds(
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
    if (run.record === undefined) return { ...run, ...none };
    const end = records.get(run.record)?.end ?? null;
    if (end !== null) return { ...run, outcome: end.outcome, ...none };
    return { ...run, pending: true, untaken: noResult.has(run.record) };
  });
}

/**
 * Row 011-241: a named wait's asked runs, one owner per wait. It gives the
 * files to ask at the first decided read, the files whose request the
 * daemon has not taken, the files to promote once it took them, and the
 * ends for the lines; `waitForNamed` calls it at those places.
 */
export class WaitAsks {
  /** The runs it asked, decided once: absent until the first decided read. */
  #runs: readonly AskedRun[] | undefined;
  /** The asked files the first promotion found untaken, emptied as the daemon takes them. */
  readonly #unpromoted = new Set<string>();

  /** `asks` is false with `--check`: a focused wait asks nothing. */
  constructor(private readonly asks: boolean) {}

  /**
   * At a decided read, the first only: the files to ask one run of, which
   * `asked` then gets the answers for. None decides that it asks nothing.
   */
  toAsk(store: Store, worktreeId: WorktreeId, own: readonly TestFileRef[], now: EpochMs) {
    if (this.#runs !== undefined) return [];
    const ask = this.asks ? askableFiles(store, worktreeId, own, now) : [];
    if (ask.length === 0) this.#runs = [];
    return ask;
  }

  /** What the asks `toAsk` gave got. */
  asked(runs: readonly AskedRun[]): void {
    this.#runs = runs;
  }

  /** The asked runs whose request the daemon has not taken at this read: each holds the wait. */
  untaken(store: Store, worktreeId: WorktreeId): readonly AskedEnd[] {
    return askedEnds(store, worktreeId, this.#runs ?? [], false).filter((e) => e.untaken);
  }

  /** At the first promotion, which holds none of `untaken`: they are promoted once taken. */
  promoted(untaken: readonly AskedEnd[]): void {
    for (const e of untaken) this.#unpromoted.add(testFileId(e.testFile));
  }

  /**
   * The asked files the daemon queued since the first promotion, which held
   * none of them, each given once: the daemon keeps a promotion only of
   * files queued or running when it comes (011 C15).
   */
  taken(untaken: readonly AskedEnd[]): TestFileRef[] {
    const waiting = new Set(untaken.map((e) => testFileId(e.testFile)));
    const taken = (this.#runs ?? []).filter(
      (r) => this.#unpromoted.has(testFileId(r.testFile)) && !waiting.has(testFileId(r.testFile)),
    );
    for (const r of taken) this.#unpromoted.delete(testFileId(r.testFile));
    return taken.map((r) => r.testFile);
  }

  /** The wait's `asked` field at its last read: the runs its lines name (`waitAsked`), absent with none. */
  ends(store: Store, worktreeId: WorktreeId): { readonly asked?: readonly AskedEnd[] } {
    const asked = waitAsked(askedEnds(store, worktreeId, this.#runs ?? [], true));
    return asked === undefined ? {} : { asked };
  }
}

/**
 * Row 011-207: a run it asked holds the wait as a pending file until the
 * daemon queues it, so a read that settles the classes with one untaken
 * keeps waiting.
 */
export function heldOutcome<T>(outcome: T | null, untaken: readonly AskedEnd[]): T | null {
  return outcome === "settled" && untaken.length > 0 ? null : outcome;
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
