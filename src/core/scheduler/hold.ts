import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isMissing, isRecord, runGit, splitNul } from "../fs/index.js";
import type { HeadState } from "../revision/index.js";
import {
  type AbsolutePath,
  type EpochMs,
  type HarnessProcess,
  type RelativePath,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

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

/** The paths a merge hold's row names at most. */
export const MERGE_HOLD_PATHS = 50;

/** How often the index file is stat'ed while on hold. */
export const MERGE_HOLD_POLL_MS = 1_000;

/** The `mergeHold` row of `meta`: the merge hold of the live daemon, absent when none. */
export interface MergeHoldRow {
  readonly v: 1;
  /** When this daemon saw the hold begin, on its clock. */
  readonly since: EpochMs;
  /** The worktree's latest revision then. */
  readonly revision: number;
  /** The first `MERGE_HOLD_PATHS` unmerged paths, in git's order. */
  readonly paths: readonly RelativePath[];
  readonly count: number;
}

/**
 * One `squeal hold -- <command>` (row 011-74, R3, which writes it): its
 * token, start, end at the latest, the command's text, and the wrapper's and
 * the command's processes as a harness process is recorded (C8).
 */
export interface CommandHoldEntry {
  readonly token: string;
  readonly since: EpochMs;
  readonly until: EpochMs;
  readonly command: string;
  readonly wrapper: HarnessProcess | null;
  readonly child: HarnessProcess | null;
}

/** `meta` key of `worktreeId`'s merge hold: a `MergeHoldRow`. */
export function mergeHoldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("mergeHold", worktreeId);
}

/** `meta` key of `worktreeId`'s command holds: `{ v: 1, entries }`. */
export function commandHoldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("commandHold", worktreeId);
}

/**
 * The merge hold the daemon started at `daemonStartedAt` published; `null`
 * with no row, an unreadable one, or one a predecessor wrote, which a live
 * daemon would have replaced at its start.
 */
export function readMergeHold(
  store: Store,
  worktreeId: WorktreeId,
  daemonStartedAt: EpochMs,
): MergeHoldRow | null {
  const raw = store.meta.get(mergeHoldMetaKey(worktreeId));
  if (raw === null) return null;
  try {
    const row: unknown = JSON.parse(raw);
    if (!isRecord(row) || row.v !== 1 || typeof row.since !== "number") return null;
    if (row.since < daemonStartedAt || typeof row.revision !== "number") return null;
    if (!Array.isArray(row.paths) || typeof row.count !== "number") return null;
    const paths = row.paths.filter((p): p is RelativePath => typeof p === "string");
    return { v: 1, since: row.since, revision: row.revision, paths, count: row.count };
  } catch {
    return null;
  }
}

/** The command holds of `worktreeId`, as written; none with no row or an unreadable one. */
export function readCommandHolds(store: Store, worktreeId: WorktreeId): CommandHoldEntry[] {
  const raw = store.meta.get(commandHoldMetaKey(worktreeId));
  if (raw === null) return [];
  try {
    const row: unknown = JSON.parse(raw);
    if (!isRecord(row) || row.v !== 1 || !Array.isArray(row.entries)) return [];
    return row.entries.filter(isCommandHold);
  } catch {
    return [];
  }
}

function isCommandHold(entry: unknown): entry is CommandHoldEntry {
  if (!isRecord(entry)) return false;
  const { token, since, until, command, wrapper, child } = entry;
  return (
    typeof token === "string" &&
    typeof since === "number" &&
    typeof until === "number" &&
    typeof command === "string" &&
    (wrapper === null || isProcess(wrapper)) &&
    (child === null || isProcess(child))
  );
}

function isProcess(value: unknown): value is HarnessProcess {
  return (
    isRecord(value) &&
    typeof value.pid === "number" &&
    typeof value.startTime === "number" &&
    typeof value.pidNamespace === "string"
  );
}

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
    if (!force && this.#read !== undefined && sameStat(before, this.#read)) return;
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
