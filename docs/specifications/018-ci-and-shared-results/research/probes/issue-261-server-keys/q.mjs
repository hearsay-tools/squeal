// Throwaway: run one read-only SQL statement against squawk's store and print rows as JSON lines.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.HOME + "/projects/cezar/.git/squeal/store.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = 1");
const sql = process.argv[2];
const t = Date.now();
for (const r of db.prepare(sql).iterate()) console.log(JSON.stringify(r));
console.error(`# ${Date.now() - t} ms`);
