// Throwaway probe (015-79): times, read-only, the row selection each batch of the code
// store's coverage prune runs inside its write transaction (src/core/code/store/prune.ts,
// deleteInBatches), with the real result-key list (prune-main.ts). Writes nothing.
// Usage: node prune-scan.mjs <commonDir>/squeal/
import { DatabaseSync } from "node:sqlite";
const dir = process.argv[2];
const main = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
const code = new DatabaseSync(dir + "code.sqlite", { readOnly: true });
let t = performance.now();
const keys = main.prepare("SELECT DISTINCT key FROM results").all().map((r) => r.key);
const json = JSON.stringify(keys);
console.log(`result keys: ${keys.length}, JSON ${(json.length / 1e6).toFixed(1)} MB, read in ${Math.round(performance.now() - t)} ms`);
console.log(`coverage rows: ${code.prepare("SELECT count(*) n FROM coverage").get().n}`);
const select = code.prepare(`SELECT result_key, provider_version FROM coverage
  WHERE result_key NOT IN (SELECT value FROM json_each(?)) LIMIT 256`);
for (let i = 0; i < 3; i++) {
  t = performance.now();
  const rows = select.all(json);
  console.log(`batch selection ${i + 1}: ${rows.length} rows in ${Math.round(performance.now() - t)} ms`);
}
