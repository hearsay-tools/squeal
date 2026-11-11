// Throwaway (row 021-03). Table sizes of a COPY of a Squeal store: rows, bytes
// (dbstat, table plus its indexes), and whether the table has a worktree column.
// Usage: node store-stats.mjs <copy of store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
const pageSize = db.prepare("PRAGMA page_size").get().page_size;
const pages = db.prepare("PRAGMA page_count").get().page_count;
const free = db.prepare("PRAGMA freelist_count").get().freelist_count;
const uv = db.prepare("PRAGMA user_version").get().user_version;
console.log(`user_version ${uv}; page_size ${pageSize}; pages ${pages} (${(pages * pageSize / 1e6).toFixed(0)} MB); freelist ${free} (${(free * pageSize / 1e6).toFixed(0)} MB)`);
const sizes = new Map();
for (const r of db.prepare("SELECT name, tbl_name FROM sqlite_schema WHERE type IN ('table','index')").all()) {
  const b = db.prepare("SELECT coalesce(sum(pgsize),0) b FROM dbstat WHERE name = ?").get(r.name).b;
  sizes.set(r.tbl_name, (sizes.get(r.tbl_name) ?? 0) + Number(b));
}
const rows = [];
for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
  const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
  const wt = cols.filter((c) => /worktree/.test(c));
  const n = db.prepare(`SELECT count(*) n FROM "${name}"`).get().n;
  rows.push({ name, rows: n, mb: (sizes.get(name) ?? 0) / 1e6, worktreeCols: wt.join(",") || "-" });
}
rows.sort((a, b) => b.mb - a.mb);
console.log("table | rows | MB (table+indexes) | worktree columns");
for (const r of rows) console.log(`${r.name} | ${r.rows} | ${r.mb.toFixed(1)} | ${r.worktreeCols}`);
