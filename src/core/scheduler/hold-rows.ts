import { toHarness } from "../delivery/harness-process.js";
import { isRecord } from "../fs/index.js";
import {
  type EpochMs,
  type HarnessProcess,
  type RelativePath,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";

/*
 * Row 011-72 (spec 011 C9 as amended 2026-10-21, "Holds"): the two `meta`
 * rows of a worktree's holds, which status and the hooks read (row 011-73).
 * The daemon writes the merge hold's (`MergeHold`); `squeal hold` writes the
 * command holds' (row 011-74). Both are trusted as the promotions' row is
 * (C15).
 */

/** The paths a merge hold's row names at most. */
export const MERGE_HOLD_PATHS = 50;

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
 * the command's processes as a harness process is recorded (C8). `child` is
 * `null` until the command was spawned; either is `null` without `/proc`.
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

/** Writes `entries` as `worktreeId`'s command holds; none removes the row. Call inside a transaction. */
function writeCommandHolds(
  store: Store,
  worktreeId: WorktreeId,
  entries: readonly CommandHoldEntry[],
): void {
  const key = commandHoldMetaKey(worktreeId);
  if (entries.length === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify({ v: 1, entries }));
}

/** `squeal hold` (row 011-74): adds its entry. */
export function addCommandHold(
  store: Store,
  worktreeId: WorktreeId,
  entry: CommandHoldEntry,
): void {
  store.transaction(() =>
    writeCommandHolds(store, worktreeId, [...readCommandHolds(store, worktreeId), entry]),
  );
}

/** Records the command's process in the entry `token`, once spawned; `false` when the entry is gone. */
export function setCommandHoldChild(
  store: Store,
  worktreeId: WorktreeId,
  token: string,
  child: HarnessProcess | null,
): boolean {
  return store.transaction(() => {
    const entries = readCommandHolds(store, worktreeId);
    if (!entries.some((e) => e.token === token)) return false;
    const next = entries.map((e) => (e.token === token ? { ...e, child } : e));
    writeCommandHolds(store, worktreeId, next);
    return true;
  });
}

/** Removes the entry `token`: the entries left, `null` when it was gone already. */
export function removeCommandHold(
  store: Store,
  worktreeId: WorktreeId,
  token: string,
): CommandHoldEntry[] | null {
  return store.transaction(() => {
    const entries = readCommandHolds(store, worktreeId);
    const left = entries.filter((e) => e.token !== token);
    if (left.length === entries.length) return null;
    writeCommandHolds(store, worktreeId, left);
    return left;
  });
}

/** `squeal start` (row 011-74): removes every entry and returns them. */
export function clearCommandHolds(store: Store, worktreeId: WorktreeId): CommandHoldEntry[] {
  return store.transaction(() => {
    const entries = readCommandHolds(store, worktreeId);
    if (store.meta.get(commandHoldMetaKey(worktreeId)) !== null)
      writeCommandHolds(store, worktreeId, []);
    return entries;
  });
}

/** An entry `pruneCommandHolds` removed, and why. */
export interface EndedCommandHold {
  readonly entry: CommandHoldEntry;
  readonly reason: "gone" | "until";
}

/**
 * Removes, in one transaction, each entry `ends` gives a reason for: the
 * daemon's check at its start and heartbeat (row 011-74). Returns them and
 * the entries left.
 */
export function pruneCommandHolds(
  store: Store,
  worktreeId: WorktreeId,
  ends: (entry: CommandHoldEntry) => EndedCommandHold["reason"] | null,
): { readonly ended: EndedCommandHold[]; readonly left: CommandHoldEntry[] } {
  return store.transaction(() => {
    const ended: EndedCommandHold[] = [];
    const left: CommandHoldEntry[] = [];
    for (const entry of readCommandHolds(store, worktreeId)) {
      const reason = ends(entry);
      if (reason === null) left.push(entry);
      else ended.push({ entry, reason });
    }
    if (ended.length > 0) writeCommandHolds(store, worktreeId, left);
    return { ended, left };
  });
}

function isCommandHold(entry: unknown): entry is CommandHoldEntry {
  if (!isRecord(entry)) return false;
  const { token, since, until, command, wrapper, child } = entry;
  return (
    typeof token === "string" &&
    typeof since === "number" &&
    typeof until === "number" &&
    typeof command === "string" &&
    (wrapper === null || toHarness(wrapper) !== undefined) &&
    (child === null || toHarness(child) !== undefined)
  );
}
