import { isRecord } from "../fs/index.js";
import type { Consumer, Store } from "../types/index.js";

/*
 * Per-consumer values kept in `meta`, one JSON row per worktree and kind:
 * `{ "<session>\n<agent>": value }`. Told liveness, the turn state and the
 * told revision live here, beside the view: `consumer_views` is keyed by
 * check, and a `consumers` column would need a schema step, which makes
 * every older hook and daemon sharing the store report "store version newer".
 * Written inside the delivery's transaction; consumers no longer registered
 * are dropped on every write.
 */

/** A consumer's name in a row. */
export const slot = (consumer: Consumer) => `${consumer.sessionId}\n${consumer.agentId}`;

/** Every value in the row `key`; empty when it is missing or unreadable. */
export function readAll(store: Store, key: string): Record<string, unknown> {
  const raw = store.meta.get(key);
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** `consumer`'s value in the row `key`; `undefined` when it has none or the row is unreadable. */
export function readSlot(store: Store, key: string, consumer: Consumer): unknown {
  return readAll(store, key)[slot(consumer)];
}

/** Records `consumer`'s value in the row `key`; `null` forgets it. Call inside a transaction. */
export function writeSlot(store: Store, key: string, consumer: Consumer, value: unknown): void {
  const registered = new Set(
    store.consumers.list(consumer.worktreeId).map((r) => slot(r.consumer)),
  );
  const all = readAll(store, key);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) if (registered.has(k)) next[k] = v;
  if (value === null) delete next[slot(consumer)];
  else next[slot(consumer)] = value;
  if (Object.keys(next).length === 0 && Object.keys(all).length === 0) return;
  store.meta.set(key, JSON.stringify(next));
}
