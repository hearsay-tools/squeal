// Row 023-25 probe: the store's meta keys and sizes, and one test file's entry in the observed maps.
import { DatabaseSync } from "node:sqlite";
const [store, path] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
for (const r of db.prepare("select key, length(value) n, value from meta").all()) {
  if (!/^(observed|startup|glob|modules)/i.test(r.key)) { console.log(r.key, r.n); continue; }
  let entry = null;
  try { entry = JSON.parse(r.value)[path] ?? null; } catch {}
  console.log(r.key, r.n, "entry:", JSON.stringify(entry));
}
