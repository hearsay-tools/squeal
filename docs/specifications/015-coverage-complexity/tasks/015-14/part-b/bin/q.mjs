// Read-only SQL against a store: node q.mjs <db> <sql>
import { DatabaseSync } from "node:sqlite";
const [db, sql] = process.argv.slice(2);
const d = new DatabaseSync(db, { readOnly: true });
d.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
const rows = d.prepare(sql).all();
console.log(JSON.stringify(rows, (k, v) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? `<${v.length} bytes>` : v)));
