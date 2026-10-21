// THROWAWAY probe (011-64 design). Copies a store through a read-only connection
// (`VACUUM INTO`), so every probe reads the copy and the live file is opened once.
// Usage: node snapshot.mjs <store.sqlite> <copy.sqlite>
import { DatabaseSync } from "node:sqlite";
import { loadavg } from "node:os";
const [src, dest] = process.argv.slice(2);
const db = new DatabaseSync(src, { readOnly: true });
const t = Date.now();
db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
db.close();
console.log(
  `copied ${src} to ${dest} in ${Date.now() - t} ms at ${new Date().toISOString()}, load ${loadavg()[0].toFixed(2)}`,
);
