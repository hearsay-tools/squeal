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
 * worktree's keys at its revision; consumers registered at one revision
 * share the record, and a record no live or parked registration names is
 * dropped at the next one.
 */

/** `meta` key of a worktree's test file keys by registration revision. */
export function registeredKeysMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("registeredKeys", worktreeId);
}

/** By revision, then by `testFileId`: the key the file had when a consumer registered there. */
type Recorded = Record<string, Record<string, CheckKey>>;

function read(store: Store, worktreeId: WorktreeId): Recorded {
  const raw = store.meta.get(registeredKeysMetaKey(worktreeId));
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    const out: Recorded = {};
    for (const [revision, keys] of Object.entries(value)) {
      if (!isRecord(keys)) continue;
      const byFile: Record<string, CheckKey> = {};
      for (const [file, key] of Object.entries(keys))
        if (typeof key === "string") byFile[file] = key;
      out[revision] = byFile;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Records the worktree's keys at `revision`, the one a consumer registered
 * at, unless a record of it is kept, and drops every record whose revision is
 * not in `kept`. Call inside the registration's transaction.
 */
export function recordRegisteredKeys(
  store: Store,
  worktreeId: WorktreeId,
  revision: RevisionNumber,
  kept: ReadonlySet<RevisionNumber>,
): void {
  const recorded = read(store, worktreeId);
  const next: Recorded = {};
  for (const [at, keys] of Object.entries(recorded)) if (kept.has(Number(at))) next[at] = keys;
  if (next[revision] === undefined) {
    const keys: Record<string, CheckKey> = {};
    for (const row of store.testFileKeys.list(worktreeId)) {
      if (row.key !== null) keys[testFileId(row.testFile)] = row.key;
    }
    next[revision] = keys;
  }
  store.meta.set(registeredKeysMetaKey(worktreeId), JSON.stringify(next));
}

/**
 * A reader of each check's baseline for a consumer registered at `since`
 * (`BeforeEdits`). With no key recorded for its file there, or no stored
 * result for the check at that key, it is `none`, naming the commit of
 * `since`. The record and each key's results are read once per reader.
 */
export function beforeEditsFor(store: Store, worktreeId: WorktreeId, since: RevisionNumber) {
  let keys: Record<string, CheckKey> | undefined;
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
    keys ??= read(store, worktreeId)[since] ?? {};
    const key = keys[testFileId(testFileOf(check))];
    return (key === undefined ? undefined : atKey(key).get(checkIdentity(check))) ?? noneAt();
  };
}
