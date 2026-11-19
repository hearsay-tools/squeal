// Throwaway (row 021-17). EXPLAIN QUERY PLAN of the code-store prune's batch searches
// (src/core/code/store/prune.ts) on an empty in-memory database with the code store's
// schema; no store is opened, nothing runs. Without table statistics: plans on real data may differ.
// Usage, from the repository root: node_modules/.bin/tsx <this file>
import { DatabaseSync } from "node:sqlite";
import { CODE_MIGRATIONS, CODE_INDEXES, CODE_TABLES } from "../../../../../../src/core/code/store/schema.ts";
const db = new DatabaseSync(":memory:");
for (const m of CODE_MIGRATIONS) m(db as never);
for (const s of Object.values(CODE_TABLES)) { try { db.exec(s); } catch {} }
for (const s of Object.values(CODE_INDEXES)) { try { db.exec(s); } catch {} }
const B = 256;
const del = (table: string, key: string, where: string) => `SELECT ${key} FROM ${table} WHERE ${where} LIMIT ${B}`;
const q: Record<string, string> = {
  dead_files: del("files", "worktree_id, path", "worktree_id IN (SELECT value FROM json_each(?))"),
  views_unregistered: del("views", "worktree_id, session_id, agent_id, check_id, measure", "(worktree_id, session_id, agent_id) NOT IN (SELECT value ->> 'worktreeId', value ->> 'sessionId', value ->> 'agentId' FROM json_each(?))"),
  counts_old: del("counts", "blob, language, counter_version", "counted_at < ? AND NOT EXISTS (SELECT 1 FROM files f WHERE f.blob = counts.blob AND f.language = counts.language AND f.counter_version = counts.counter_version) AND counts.blob NOT IN (SELECT s.blob FROM states s)"),
  coverage_keys: del("coverage", "result_key, provider_version", "result_key IN (SELECT value FROM json_each(?)) OR provider_version < ?"),
  checks_unused: del("checks", "id", "id NOT IN (SELECT check_id FROM states UNION SELECT check_id FROM views UNION SELECT check_id FROM transitions)"),
};
for (const [k, s] of Object.entries(q)) {
  const plan = db.prepare("EXPLAIN QUERY PLAN " + s).all().map((r: any) => r.detail).join(" | ");
  console.log(k + ": " + plan);
}
