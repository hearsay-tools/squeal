// Throwaway probe for 015-10 Part C. Not product code. Run as squeal-e2e.
//   node store-sizes.mjs <code.sqlite>   row counts per table and view rows per session, read only
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
  console.log(name, db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n);
for (const r of db.prepare("SELECT session_id, count(*) AS n, min(told_at) AS at FROM views GROUP BY session_id ORDER BY at").all())
  console.log("view", r.session_id.slice(0, 8), r.n, new Date(r.at).toISOString());
