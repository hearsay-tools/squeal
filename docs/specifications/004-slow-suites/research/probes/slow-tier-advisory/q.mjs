// Throwaway, read-only: runs SQL queries against a Squeal store opened readOnly. Usage: node q.mjs <store> "<sql>"...
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
for (const q of process.argv.slice(3)) { console.log("> " + q); for (const r of db.prepare(q).all()) console.log(JSON.stringify(r)); }
