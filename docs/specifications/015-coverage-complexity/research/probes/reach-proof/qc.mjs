import { DatabaseSync } from "node:sqlite";
for (const f of process.argv.slice(2)) {
  const t = Date.now();
  const db = new DatabaseSync(f);
  const r = db.prepare("PRAGMA quick_check").all();
  console.log(f, JSON.stringify(r.slice(0, 3)), `${Date.now() - t} ms`);
  db.close();
}
