// Throwaway (026, tiered-pre-pr). Runs one SQL statement read-only against a
// copied store and prints rows as tab-separated lines.
// Usage: node q.mjs <store copy> "<sql>"
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare(process.argv[3]).all();
if (rows.length) console.log(Object.keys(rows[0]).join("\t"));
for (const r of rows) console.log(Object.values(r).join("\t"));
