// Throwaway: read-only query against a Squeal store. Usage: node q.mjs <store.sqlite> "<sql>"
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare(process.argv[3]).all();
for (const r of rows) console.log(JSON.stringify(r));
