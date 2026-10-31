// Throwaway probe (018-03). Rows and bytes per table of a COPIED store.
// Usage: node table-sizes.mjs <copy/store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
db.exec("PRAGMA integrity_check"); // fails loudly if the copy is torn
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
let dbstat = true;
for (const { name } of tables) {
  const rows = db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n;
  let bytes = null;
  if (dbstat) {
    try {
      bytes = db.prepare("SELECT SUM(pgsize) b FROM dbstat WHERE name = ?").get(name).b;
    } catch { dbstat = false; }
  }
  console.log(JSON.stringify({ table: name, rows, bytes }));
}
for (const idx of db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index'").all()) {
  if (!dbstat) break;
  const b = db.prepare("SELECT SUM(pgsize) b FROM dbstat WHERE name = ?").get(idx.name).b;
  console.log(JSON.stringify({ index: idx.name, table: idx.tbl_name, bytes: b }));
}
const meta = db.prepare("SELECT key, length(value) len FROM meta ORDER BY len DESC LIMIT 15").all();
console.log(JSON.stringify({ largestMeta: meta }));
console.log(JSON.stringify({ worktrees: db.prepare("SELECT COUNT(*) n FROM worktrees").get().n,
  distinctResultKeys: db.prepare("SELECT COUNT(DISTINCT key) n FROM results").get().n,
  distinctFileKeys: db.prepare("SELECT COUNT(DISTINCT key) n FROM test_file_keys").get().n }));
