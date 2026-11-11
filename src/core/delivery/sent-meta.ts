import type { Statement } from "../daemon/write-batch.js";
import type { Params, Row } from "../store/connection.js";

/*
 * Spec 021 D15 (row 021-16): a hook that holds a report keeps its writes
 * until the host has the text, and reads on meanwhile, as Stop does when it
 * counts its hold after telling news. Each consumer's told state lives in
 * `meta` rows (`slots.ts`), which it reads and writes again, so those reads
 * see the hook's own kept writes of the row first. The statements are the
 * store's own (`store.ts` `createMetaRepo`, `meta-list.ts`).
 */

const READ = "SELECT value FROM meta WHERE key = ?";
const SETS = new Set([
  "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
]);
const DELETE = "DELETE FROM meta WHERE key = ?";

/**
 * The row `sql` reads when it reads one `meta` key the `pending` writes
 * wrote last: `null` when they deleted it. `undefined` when `sql` is
 * another read, or no pending write touched the key, so the store answers.
 */
export function overlaidMeta(
  sql: string,
  params: Params,
  pending: readonly Statement[],
): Row | null | undefined {
  if (sql !== READ || pending.length === 0) return undefined;
  const key = params[0];
  for (let i = pending.length - 1; i >= 0; i--) {
    const write = pending[i] as Statement;
    if (write.params[0] !== key) continue;
    if (SETS.has(write.sql)) return { value: write.params[1] };
    if (write.sql === DELETE) return null;
  }
  return undefined;
}
