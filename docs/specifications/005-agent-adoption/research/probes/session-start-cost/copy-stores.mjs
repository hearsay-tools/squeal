// Throwaway. Copies one live store file to a scratch path with SQLite's backup API,
// all pages in one step (rate 2^31-1), from a read-only connection: one consistent snapshot, no write
// to the live store. Usage: node copy-stores.mjs <live.sqlite> <copy.sqlite>
import { DatabaseSync, backup } from "node:sqlite";
const [from, to] = process.argv.slice(2);
const src = new DatabaseSync(from, { readOnly: true });
src.exec("PRAGMA busy_timeout = 10000");
const t0 = performance.now();
const pages = await backup(src, to, { rate: 2147483647 });
console.log(JSON.stringify({ from, to, pages, ms: Math.round(performance.now() - t0) }));
src.close();
