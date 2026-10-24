// Values of stored complexity transitions for named functions, read only.
// Usage: node transition-values.mjs <code.sqlite> <name>...
import { DatabaseSync } from "node:sqlite";
const [path, ...names] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
const cols = db.prepare("PRAGMA table_info(checks)").all().map((c) => c.name);
const nameCol = cols.find((c) => /name/.test(c));
for (const n of names) {
  const rows = db.prepare(`SELECT t.worktree_id, t.kind, t.from_value, t.to_value, t.revision, t.at FROM transitions t JOIN checks c ON c.id = t.check_id WHERE c.${nameCol} = ? ORDER BY t.at`).all(n);
  for (const r of rows) console.log(n, r.worktree_id, r.kind, r.from_value, "->", r.to_value, "rev", r.revision, new Date(r.at).toISOString());
}
