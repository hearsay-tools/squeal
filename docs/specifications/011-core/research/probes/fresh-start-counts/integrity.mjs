// 011-223 probe: what the daemon's store open costs on a store copy: integrity_check (what openDaemon runs),
// quick_check (the cheaper pragma), page counts. Opens the copy read-only.
// usage: node integrity.mjs <store copy> [repeats=2]
import { DatabaseSync } from "node:sqlite";
import { loadavg } from "node:os";
const [file, repeats = "2"] = process.argv.slice(2);
const db = new DatabaseSync(file, { readOnly: true });
const n = (p) => Number(Object.values(db.prepare(`PRAGMA ${p}`).get())[0]);
console.log(JSON.stringify({ file, pageSize: n("page_size"), pages: n("page_count"), freelist: n("freelist_count") }));
for (let i = 0; i < Number(repeats); i++) {
  for (const pragma of ["integrity_check", "quick_check"]) {
    const load = loadavg()[0].toFixed(1);
    const t = performance.now();
    const cpu = process.cpuUsage();
    const rows = db.prepare(`PRAGMA ${pragma}`).all();
    const ms = performance.now() - t;
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ pragma, ms: Math.round(ms), cpuMs: Math.round((used.user + used.system) / 1000), ok: rows.length === 1 && Object.values(rows[0])[0] === "ok", load1: load }));
  }
}
