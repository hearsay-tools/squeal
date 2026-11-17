// Throwaway (keys-by-walk): a whole-store copy of a live Squeal store with VACUUM INTO.
// The live store is opened read-only. Usage: node copy-store.mjs <live store> <copy>
import { DatabaseSync } from "node:sqlite";
const [src, dst] = process.argv.slice(2);
const live = new DatabaseSync(src, { readOnly: true });
// query_only refuses VACUUM INTO; the readOnly open still refuses every write to the live file.
const t0 = Date.now();
live.exec(`VACUUM INTO '${dst.replaceAll("'", "''")}'`);
console.log(JSON.stringify({ src, dst, ms: Date.now() - t0 }));
