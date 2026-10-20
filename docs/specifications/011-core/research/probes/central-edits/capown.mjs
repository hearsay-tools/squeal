// THROWAWAY probe (011-core/research/central-edits.md, question 2). Own test files that a cap of 12
// direct importers (the 12 shortest by median recorded duration) would leave off the edit route.
import { readResult } from "./graph.mjs";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const per = db.prepare(`select c.project, c.test_path path, r.run_id, sum(r.duration_ms) ms from results r join checks c on c.id = r.check_id group by c.project, c.test_path, r.run_id`).all();
const by = new Map(); for (const r of per) { const id = `${r.project}:${r.path}`; (by.get(id) ?? by.set(id, []).get(id)).push(r.ms / 1000); }
const med = (xs) => { const s = [...(xs ?? [])].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 1; };
for (const f of ["direct", "direct-all"]) {
  const d = readResult(f); let own = 0, lost = []; 
  for (const o of d) { const dir = o.files.filter(x => x.cls === "direct").map(x => ({ id: x.id, s: med(by.get(x.id)) })).sort((a, b) => a.s - b.s).slice(0, 12).map(x => x.id);
    for (const w of o.own) { own++; if (w.cls === "direct" && !dir.includes(w.id)) lost.push(`${o.rev} ${w.id}`); } }
  console.log(f, own, "lost under cap 12:", lost.length, [...new Set(lost.map(l => l.split(" ").pop()))].join(" "));
}
