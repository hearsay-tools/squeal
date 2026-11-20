// 011-416 probe (throwaway): read-only ad hoc queries on a store copy, one JSON line per row.
// Usage: node q.mjs <store copy> <sql>...
import { DatabaseSync } from "node:sqlite";
const [, , path, ...sqls] = process.argv;
const db = new DatabaseSync(path, { readOnly: true });
for (const sql of sqls) for (const r of db.prepare(sql).all()) console.log(JSON.stringify(r));
