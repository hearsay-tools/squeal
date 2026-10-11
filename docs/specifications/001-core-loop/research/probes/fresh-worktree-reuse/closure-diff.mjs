import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
const [db, a, b, ...paths] = process.argv.slice(2);
const d = new DatabaseSync(db, { readOnly: true });
const h = (p) => !existsSync(p) ? "absent" : statSync(p).isDirectory() ? "dir:" + readdirSync(p).sort().join("|").slice(0, 60) : createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
for (const path of paths) {
  const rows = d.prepare("select project, closure_paths, complete, method, datetime(updated_at/1000,'unixepoch') at, updated_by from test_files where path=?").all(path);
  for (const r of rows) {
    const cl = JSON.parse(r.closure_paths);
    console.log(path, r.project, "closure", cl.length, "complete", r.complete, r.method, r.at, r.updated_by);
    for (const p of cl) { const ha = h(`${a}/${p}`), hb = h(`${b}/${p}`); if (ha !== hb) console.log("  DIFF", p, ha, hb); }
  }
}
