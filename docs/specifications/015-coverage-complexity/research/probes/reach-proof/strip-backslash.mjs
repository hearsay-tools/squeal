import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2]);
let removed = 0;
for (const r of db.prepare("select key, value from meta where key like 'observed%'").all()) {
  let v; try { v = JSON.parse(r.value); } catch { continue; }
  let changed = false;
  for (const [t, ps] of Object.entries(v)) {
    if (!Array.isArray(ps)) continue;
    const kept = ps.filter((p) => !p.includes("\\"));
    if (kept.length !== ps.length) { removed += ps.length - kept.length; v[t] = kept; changed = true; }
  }
  if (changed) db.prepare("update meta set value = ? where key = ?").run(JSON.stringify(v), r.key);
}
console.log("backslash observed paths removed:", removed);
db.close();
