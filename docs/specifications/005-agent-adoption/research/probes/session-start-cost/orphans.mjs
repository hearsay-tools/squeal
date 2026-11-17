// Throwaway. Rows of per-worktree tables no hook read reaches, on a store copy, read-only:
// rows of worktrees not in `worktrees`, rows of worktrees whose root is gone, consumer views of
// consumers not registered, and known states not listed in test_file_keys' test files.
// Usage: node orphans.mjs <copy.sqlite>
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const one = (sql, ...a) => Number(Object.values(db.prepare(sql).get(...a))[0]);
const gone = db.prepare("SELECT id, root FROM worktrees").all().filter((w) => !existsSync(w.root)).map((w) => w.id);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  .filter((t) => db.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === "worktree_id"));
for (const t of tables) {
  const all = one(`SELECT COUNT(*) FROM "${t}"`);
  const orphan = one(`SELECT COUNT(*) FROM "${t}" WHERE worktree_id NOT IN (SELECT id FROM worktrees)`);
  const ofGone = gone.length ? one(`SELECT COUNT(*) FROM "${t}" WHERE worktree_id IN (SELECT value FROM json_each(?))`, JSON.stringify(gone)) : 0;
  if (orphan || ofGone) console.log(`${t}: ${all} rows; of unlisted worktrees ${orphan}; of removed roots ${ofGone}`);
}
console.log("consumer_views of consumers not registered:", one(`SELECT COUNT(*) FROM consumer_views v WHERE NOT EXISTS (SELECT 1 FROM consumers c WHERE c.worktree_id=v.worktree_id AND c.session_id=v.session_id AND c.agent_id=v.agent_id)`), "of", one("SELECT COUNT(*) FROM consumer_views"));
console.log("known_states whose check's test file is not keyed in its worktree:", one(`SELECT COUNT(*) FROM known_states s JOIN checks c ON c.id=s.check_id WHERE NOT EXISTS (SELECT 1 FROM test_file_keys k WHERE k.worktree_id=s.worktree_id AND k.path=c.test_path)`), "of", one("SELECT COUNT(*) FROM known_states"));
console.log("runs:", one("SELECT COUNT(*) FROM runs"), "open (end_state NULL):", one("SELECT COUNT(*) FROM runs WHERE end_state IS NULL"), "oldest started:", new Date(one("SELECT MIN(started_at) FROM runs")).toISOString());
