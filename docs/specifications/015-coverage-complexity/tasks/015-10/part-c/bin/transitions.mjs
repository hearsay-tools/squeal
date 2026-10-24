// Throwaway probe for 015-10 Part C. Not product code. Run as squeal-e2e.
//   node transitions.mjs <code.sqlite> <path substring>   transitions and views of matching checks, read only
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const cols = db.prepare("PRAGMA table_info(checks)").all().map((c) => c.qualified_name);
console.log("checks columns:", cols.join(","));
const rows = db.prepare(`SELECT t.*, c.path, c.qualified_name FROM transitions t JOIN checks c ON c.id = t.check_id WHERE c.path LIKE ? ORDER BY t.id`).all(`%${process.argv[3]}%`);
for (const r of rows) console.log(JSON.stringify(r));
const views = db.prepare(`SELECT v.*, c.qualified_name FROM views v JOIN checks c ON c.id = v.check_id WHERE c.path LIKE ?`).all(`%${process.argv[3]}%`);
for (const v of views) console.log("view", JSON.stringify(v));
