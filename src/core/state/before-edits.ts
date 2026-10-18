import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import type {
  BeforeEdits,
  CheckId,
  CheckKey,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../types/index.js";
import { worktreeMetaKey } from "../types/index.js";
import { checkIdentity, testFileOf } from "./derive.js";

/*
 * 011 C5 as amended (the human, gh-32, task 011-18): a first-seen failure's
 * baseline is the stored result for the check at the key its test file had
 * at the revision current when the session registered, from any worktree
 * through the shared store, looked up and never run for this purpose. The
 * store keeps only each file's current key, so a registration records the
 * worktree's keys as it sees them. Keys can grow without a revision (review
 * wave 2b, B1), so each consumer slot names its own snapshot; consumers that
 * saw the same keys share one. A resumed consumer keeps its snapshot, and a
 * snapshot no live or unexpired parked consumer names is dropped at the next
 * registration (S1).
 */

/** `meta` key of a worktree's test file keys as its consumers registered. */
export function registeredKeysMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("registeredKeys", worktreeId);
}

/** Each `testFileId` to the key the file had. */
type Keys = Record<string, CheckKey>;

/** Distinct snapshots, and each consumer slot's index into them. */
interface Recorded {
  readonly snapshots: readonly Keys[];
  readonly slots: Readonly<Record<string, number>>;
}

const EMPTY: Recorded = { snapshots: [], slots: {} };

function toKeys(value: unknown): Keys {
  const keys: Keys = {};
  if (!isRecord(value)) return keys;
  for (const [file, key] of Object.entries(value)) if (typeof key === "string") keys[file] = key;
  return keys;
}

/** The row; empty when missing, unreadable or in 0.1.217's by-revision form. */
function read(store: Store, worktreeId: WorktreeId): Recorded {
  const raw = store.meta.get(registeredKeysMetaKey(worktreeId));
  if (raw === null) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value.snapshots) || !isRecord(value.slots)) return EMPTY;
    const snapshots = value.snapshots.map(toKeys);
    const slots: Record<string, number> = {};
    for (const [slot, at] of Object.entries(value.slots)) {
      if (typeof at === "number" && snapshots[at] !== undefined) slots[slot] = at;
    }
    return { snapshots, slots };
  } catch {
    return EMPTY;
  }
}

/** A snapshot's identity: its entries in file order. */
const identity = (keys: Keys): string =>
  JSON.stringify(Object.entries(keys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Records the snapshot consumer `slot` registered with: the worktree's keys
 * now, or, when it `resumed` a parked registration, the one it had (none
 * when it had none: keys taken now may hold its own edits). Drops every slot
 * not in `kept` and every snapshot no kept slot names. Call inside the
 * registration's transaction.
 */
export function recordRegisteredKeys(
  store: Store,
  worktreeId: WorktreeId,
  slot: string,
  { resumed, kept }: { readonly resumed: boolean; readonly kept: ReadonlySet<string> },
): void {
  const recorded = read(store, worktreeId);
  const named = new Map<string, Keys>();
  for (const [at, index] of Object.entries(recorded.slots)) {
    const keys = recorded.snapshots[index];
    if (keys !== undefined && kept.has(at) && (resumed || at !== slot)) named.set(at, keys);
  }
  if (!resumed) {
    const keys: Keys = {};
    for (const row of store.testFileKeys.list(worktreeId)) {
      if (row.key !== null) keys[testFileId(row.testFile)] = row.key;
    }
    named.set(slot, keys);
  }
  const snapshots: Keys[] = [];
  const indexOf = new Map<string, number>();
  const slots: Record<string, number> = {};
  for (const [at, keys] of named) {
    const id = identity(keys);
    let index = indexOf.get(id);
    if (index === undefined) {
      index = snapshots.push(keys) - 1;
      indexOf.set(id, index);
    }
    slots[at] = index;
  }
  store.meta.set(registeredKeysMetaKey(worktreeId), JSON.stringify({ snapshots, slots }));
}

/**
 * A reader of each check's baseline for consumer `slot`, registered at
 * `since` (`BeforeEdits`). With no snapshot for the slot, no key in it for
 * the check's file, or no stored result for the check at that key, it is
 * `none`, naming the commit of `since`. The snapshot and each key's results
 * are read once per reader.
 */
export function beforeEditsFor(
  store: Store,
  worktreeId: WorktreeId,
  slot: string,
  since: RevisionNumber,
) {
  let keys: Keys | undefined;
  const results = new Map<CheckKey, Map<string, BeforeEdits>>();
  let none: BeforeEdits | undefined;
  const noneAt = (): BeforeEdits => {
    none ??= { outcome: "none", commit: store.revisions.get(worktreeId, since)?.head ?? null };
    return none;
  };
  const atKey = (key: CheckKey) => {
    let byCheck = results.get(key);
    if (byCheck === undefined) {
      byCheck = new Map();
      for (const r of store.results.byKey(key)) {
        const { worktreeId: from, commit } = r.provenance;
        const before: BeforeEdits | null =
          r.outcome === "pass"
            ? { outcome: "pass" }
            : r.outcome === "fail"
              ? {
                  outcome: "fail",
                  worktreeId: from,
                  worktreeRoot: store.worktrees.get(from)?.root ?? null,
                  commit,
                }
              : null;
        if (before !== null) byCheck.set(checkIdentity(r.check), before);
      }
      results.set(key, byCheck);
    }
    return byCheck;
  };
  return (check: CheckId): BeforeEdits => {
    if (keys === undefined) {
      const recorded = read(store, worktreeId);
      const index = recorded.slots[slot];
      keys = (index === undefined ? undefined : recorded.snapshots[index]) ?? {};
    }
    const key = keys[testFileId(testFileOf(check))];
    return (key === undefined ? undefined : atKey(key).get(checkIdentity(check))) ?? noneAt();
  };
}
