// Throwaway. Table and index sizes (dbstat) and row counts of one store copy, read-only.
// Usage: node table-sizes.mjs <copy.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
let sizes = new Map();
try {
  for (const r of db.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all()) sizes.set(r.name, r.bytes);
} catch (e) { console.error("dbstat unavailable:", e.message); }
const objs = db.prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index') ORDER BY tbl_name, type DESC").all();
const out = [];
for (const o of objs) {
  const rows = o.type === "table" ? Number(Object.values(db.prepare(`SELECT COUNT(*) FROM "${o.name}"`).get())[0]) : null;
  out.push({ type: o.type, name: o.name, table: o.tbl_name, rows, mib: sizes.has(o.name) ? +(sizes.get(o.name) / 2 ** 20).toFixed(1) : null });
}
const byTable = new Map();
for (const o of out) { const t = byTable.get(o.table) ?? { table: o.table, rows: 0, tableMiB: 0, indexMiB: 0, indexes: [] }; if (o.type === "table") { t.rows = o.rows; t.tableMiB = o.mib; } else { t.indexMiB += o.mib ?? 0; t.indexes.push(o.name); } byTable.set(o.table, t); }
const list = [...byTable.values()].sort((a, b) => (b.tableMiB + b.indexMiB) - (a.tableMiB + a.indexMiB));
for (const t of list) console.log([t.table, t.rows, t.tableMiB, +t.indexMiB.toFixed(1), t.indexes.join(",")].join("\t"));
