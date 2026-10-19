import { isRecord } from "../fs/index.js";
import {
  type CheckKey,
  type RelativePath,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import type { TokenRecord, TokenRecords } from "./rank.js";

/**
 * The `meta` row of one source path's token record (004 D2: "one token set
 * per slow file is kept in the store, keyed by the hashes of the file and its
 * helpers"). Shared across worktrees: a record is used only at its hash.
 */
export function slowTokensMetaKey(path: RelativePath): string {
  return `slow-tokens:${path}`;
}

/** Token records in the store's `meta`, one row per path; a row that does not parse is none. */
export function metaTokenRecords(store: Store): TokenRecords {
  return {
    get(path) {
      const key = slowTokensMetaKey(path);
      return parseRecord(store.meta.get(key));
    },
    set(path, record) {
      const key = slowTokensMetaKey(path);
      store.meta.set(key, JSON.stringify(record));
    },
  };
}

function parseRecord(text: string | null): TokenRecord | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      isRecord(value) &&
      typeof value.hash === "string" &&
      strings(value.words) &&
      strings(value.phrases) &&
      strings(value.helpers)
    ) {
      return value as unknown as TokenRecord;
    }
  } catch {}
  return null;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((s) => typeof s === "string");
}

/** The tokens that ranked one slow file, at the key it was queued for. */
export interface RankedBy {
  readonly key: CheckKey;
  readonly tokens: readonly string[];
}

/**
 * Writes the tokens that ranked this worktree's slow files, by `testFileId`,
 * for `squeal why` (004 D2: "`why <slow file>` names the tokens that ranked
 * it"). The daemon's queue holds them; this row is what a CLI reads.
 */
export function publishSlowEvidence(
  store: Store,
  worktreeId: WorktreeId,
  ranked: ReadonlyMap<string, RankedBy>,
): void {
  const key = worktreeMetaKey("slowEvidence", worktreeId);
  if (ranked.size === 0) store.meta.delete(key);
  else store.meta.set(key, JSON.stringify(Object.fromEntries(ranked)));
}

export function readSlowEvidence(store: Store, worktreeId: WorktreeId): Map<string, RankedBy> {
  const key = worktreeMetaKey("slowEvidence", worktreeId);
  const text = store.meta.get(key);
  const out = new Map<string, RankedBy>();
  if (text === null) return out;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return out;
    for (const [id, entry] of Object.entries(value)) {
      if (isRecord(entry) && typeof entry.key === "string" && strings(entry.tokens)) {
        out.set(id, { key: entry.key as CheckKey, tokens: entry.tokens });
      }
    }
  } catch {}
  return out;
}
