// Throwaway probe (016-27): runs one read-only SQL statement against a store and prints rows as JSON lines.
import { DatabaseSync } from "node:sqlite";
const [file, sql, ...params] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
for (const r of db.prepare(sql).all(...params)) console.log(JSON.stringify(r));
