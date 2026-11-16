// Throwaway: one read-only query against a Squeal store. Usage: node q.mjs <store.sqlite> "<sql>"
import { DatabaseSync } from "node:sqlite";
const [store, sql] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const rows = db.prepare(sql).all();
for (const r of rows) console.log(JSON.stringify(r));
