// Throwaway. PRAGMA quick_check on a store COPY, whole or one table (and its indexes), read-only,
// as the daemon's open runs it (src/core/store/open.ts:208). Prints ms and the result.
// Usage: node quick-check.mjs <copy.sqlite> [table]
import { loadavg } from "node:os";
import { DatabaseSync } from "node:sqlite";
const [path, table] = process.argv.slice(2);
if (!path.includes("/t/38faef1c/")) throw new Error("copies only");
const db = new DatabaseSync(path, { readOnly: true });
const t = performance.now();
const rows = db.prepare(table ? `PRAGMA quick_check("${table}")` : "PRAGMA quick_check").all();
console.log(JSON.stringify({ path: path.split("/").slice(-3).join("/"), table: table ?? null, ms: Math.round(performance.now() - t), result: rows.map((r) => r.quick_check).join("; ").slice(0, 80), load1: +loadavg()[0].toFixed(1) }));
