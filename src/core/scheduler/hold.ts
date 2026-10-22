import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isMissing, runGit, splitNul } from "../fs/index.js";
import type { HeadState } from "../revision/index.js";
import { createStateSink } from "../state/index.js";
import type {
  AbsolutePath,
  CheckKey,
  EpochMs,
  RelativePath,
  ResultRepo,
  StateSink,
  Store,
  WorktreeId,
} from "../types/index.js";
import {
  MERGE_HOLD_PATHS,
  type MergeHoldRow,
  mergeHoldMetaKey,
  readMergeHold,
} from "./hold-rows.js";

/*
 * Row 011-72 (spec 011 C9 as amended 2026-10-21, "Holds"; `tasks/011-61/design.md`
 * R1): a worktree's validation is on hold while git lists an unmerged path. The
 * daemon records revisions, keys, looks up and queues as usual; no tier starts,
 * and a key that names an unmerged path takes no stored result and stores none.
 * The paths come from the `git status` of each revision (`readHead`), and from
 * `git ls-files -u` whenever the index file moved since the last read: at the
 * start, in each pass that is not a watch batch, before a tier and at a
 * record, and every second while on hold, so `git add` or an abort ends the
 * hold without a revision.
 */

/** How often the index file is stat'ed while on hold. */
export const MERGE_HOLD_POLL_MS = 1_000;

/** The paths `git ls-files -u -z` lists, each once, in git's order. */
export function unmergedIndexPaths(output: string): RelativePath[] {
  const paths = new Set<RelativePath>();
  for (const entry of splitNul(output)) {
    const tab = entry.indexOf("\t");
    if (tab >= 0) paths.add(entry.slice(tab + 1));
  }
  return [...paths];
}

/** What the index file's stat compares: every write of it moves one of these. */
type IndexStat = { readonly ino: number; readonly size: number; readonly mtimeMs: number } | null;

const sameStat = (a: IndexStat, b: IndexStat): boolean =>
  a === b ||
  (a !== null && b !== null && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs);

export interface MergeHoldOptions {
  readonly root: AbsolutePath;
  readonly store: Store;
  readonly worktreeId: WorktreeId;
  readonly now: () => EpochMs;
  /** The worktree's latest revision, which the row names. */
  readonly revision: () => number;
  /** A poll found the hold ended: the queued work may start. */
  readonly resumed: () => void;
  readonly note: (message: string) => void;
  readonly pollMs?: number;
}

/**
 * The merge hold of one worktree: the unmerged paths as last read, the
 * index file's stat they were read at, and its `meta` row. A read
 * that began before the last one applied is dropped, so an older listing
 * never replaces a newer one.
 */
export class MergeHold {
  #paths: readonly RelativePath[] = [];
  #named: ReadonlySet<RelativePath> = new Set();
  #since: EpochMs = 0;
  #revision = 0;
  /** Paths that left the listing since `takeReleased`: their bytes may have moved with the index. */
  #released = new Set<RelativePath>();
  #index: Promise<AbsolutePath> | null = null;
  /** The index's stat at the last applied read; `undefined` before the first. */
  #read: IndexStat | undefined = undefined;
  #begun = 0;
  #applied = 0;
  /** The row may differ from what was read: written at the next apply even when nothing moved. */
  #unpublished = true;
  #failed: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #polling = false;
  #closed = false;

  constructor(private readonly options: MergeHoldOptions) {}

  get holding(): boolean {
    return this.#paths.length > 0;
  }

  get paths(): readonly RelativePath[] {
    return this.#paths;
  }

  /** Whether any of `paths` is unmerged now. */
  names(paths: Iterable<RelativePath>): boolean {
    if (!this.holding) return false;
    for (const path of paths) if (this.#named.has(path)) return true;
    return false;
  }

  /** `read`, with the unmerged paths it listed applied at the index stat taken before it. */
  async head(read: () => Promise<HeadState>): Promise<HeadState> {
    const ticket = ++this.#begun;
    const before = await this.#stat();
    const state = await read();
    if (state.unmerged !== undefined) this.#apply(ticket, before, state.unmerged);
    return state;
  }

  /**
   * Reads the unmerged paths again when the index file moved since the last
   * read, or with `force`. A failed read leaves the hold as it was, with one
   * note until a read succeeds.
   */
  async check(force = false): Promise<void> {
    if (this.#closed) return;
    const ticket = ++this.#begun;
    const before = await this.#stat();
    // A row that failed to write is written again at the next check, moved or not.
    const unmoved = this.#read !== undefined && sameStat(before, this.#read);
    if (!force && unmoved && !this.#unpublished) return;
    try {
      const out = await runGit(this.options.root, ["ls-files", "-u", "-z"]);
      this.#failed = null;
      this.#apply(ticket, before, unmergedIndexPaths(out));
    } catch (error) {
      const message = String(error);
      if (this.#failed !== message)
        this.options.note(`squeal: could not list unmerged paths: ${message}`);
      this.#failed = message;
    }
  }

  /** The paths that left the listing since the last call; their bytes are reconciled before a tier. */
  takeReleased(): RelativePath[] {
    const released = [...this.#released];
    this.#released.clear();
    return released;
  }

  close(): void {
    this.#closed = true;
    this.#stopPolling();
  }

  #apply(ticket: number, before: IndexStat, paths: readonly RelativePath[]): void {
    if (this.#closed || ticket < this.#applied) return;
    this.#applied = ticket;
    this.#read = before;
    const same = paths.length === this.#paths.length && paths.every((p, i) => p === this.#paths[i]);
    if (same && !this.#unpublished) return;
    const was = this.holding;
    const named = new Set(paths);
    for (const path of this.#paths) if (!named.has(path)) this.#released.add(path);
    this.#paths = [...paths];
    this.#named = named;
    if (this.holding && !was) {
      this.#since = this.options.now();
      this.#revision = this.options.revision();
      this.#poll();
    }
    if (!this.holding) this.#stopPolling();
    this.#publish();
  }

  #publish(): void {
    const { store, worktreeId, note } = this.options;
    const key = mergeHoldMetaKey(worktreeId);
    try {
      if (!this.holding) store.meta.delete(key);
      else {
        const row: MergeHoldRow = {
          v: 1,
          since: this.#since,
          revision: this.#revision,
          paths: this.#paths.slice(0, MERGE_HOLD_PATHS),
          count: this.#paths.length,
        };
        store.meta.set(key, JSON.stringify(row));
      }
      this.#unpublished = false;
    } catch (error) {
      this.#unpublished = true;
      note(`squeal: could not record the merge hold: ${String(error)}`);
    }
  }

  /** Stats the index every `pollMs` while on hold; tells `resumed` when a poll ends it. */
  #poll(): void {
    if (this.#timer !== null || this.#closed) return;
    this.#timer = setInterval(() => {
      if (this.#polling) return;
      this.#polling = true;
      this.check()
        .then(() => {
          if (!this.holding && !this.#closed) this.options.resumed();
        })
        .finally(() => {
          this.#polling = false;
        });
    }, this.options.pollMs ?? MERGE_HOLD_POLL_MS);
    this.#timer.unref();
  }

  #stopPolling(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** The index file's stat; `null` when there is none. Its path is read once. */
  async #stat(): Promise<IndexStat> {
    this.#index ??= runGit(this.options.root, ["rev-parse", "--git-path", "index"]).then((out) =>
      resolve(this.options.root, out.trim()),
    );
    try {
      const { ino, size, mtimeMs } = await stat(await this.#index);
      return { ino, size, mtimeMs };
    } catch (error) {
      if (!isMissing(error)) this.#index = null;
      return null;
    }
  }
}

/** The files of `files` whose keys name an unmerged path, through their inputs or what their run read beyond them. */
export function heldFiles<
  T extends { readonly file: { readonly id: string }; readonly inputs: readonly RelativePath[] },
>(
  hold: MergeHold,
  files: readonly T[],
  growth?: ReadonlyMap<string, { readonly growth: readonly RelativePath[] }>,
): T[] {
  if (!hold.holding) return [];
  return files.filter(
    (f) => hold.names(f.inputs) || hold.names(growth?.get(f.file.id)?.growth ?? []),
  );
}

/**
 * Review 0.1.266, B1: whether the merge hold `worktreeId`'s last daemon
 * published names one of `paths`, a stored key's inputs, so the key takes
 * no stored result there (011 C9). A row that lists fewer paths than it
 * counts names every key: the rest are not known here.
 */
export function holdsAt(
  store: Store,
  worktreeId: WorktreeId,
  paths: readonly RelativePath[],
): boolean {
  const startedAt = store.worktrees.lastDaemon(worktreeId)?.startedAt ?? 0;
  const row = readMergeHold(store, worktreeId, startedAt);
  if (row === null) return false;
  if (row.count > row.paths.length) return true;
  const unmerged = new Set(row.paths);
  return paths.some((path) => unmerged.has(path));
}

/**
 * Which other worktrees `storeResults` heals at a key whose inputs are
 * `paths`: those whose merge hold names none of them. The others keep their
 * states, and their daemons decide under their own hold (`Ledger.confirmHeld`).
 */
export function healsUnheld(
  store: Store,
  paths: readonly RelativePath[],
): (worktreeId: WorktreeId) => boolean {
  return (worktreeId) => !holdsAt(store, worktreeId, paths);
}

/**
 * A sink over `store` that reads no result stored at `keys`: what refreshes
 * the known states of the files the merge hold holds, whose keys take no
 * stored result (011 C9). A view of the store, as a wrapped store's
 * `Proxy` is (`readTransaction`); the rest reads and writes the store itself.
 */
export function sinkWithoutResults(
  store: Store,
  keys: ReadonlySet<CheckKey>,
  now: () => EpochMs,
): StateSink {
  const results: ResultRepo = {
    ...store.results,
    byKey: (key, usedAt) => (key !== null && keys.has(key) ? [] : store.results.byKey(key, usedAt)),
  };
  const view = new Proxy(store, {
    get: (target, property, receiver) =>
      property === "results" ? results : Reflect.get(target, property, receiver),
  });
  return createStateSink(view, { now });
}
