// THROWAWAY probe (011-core/research/central-edits.md, question 2). Guard-like files outside the import graph in small revisions.
// From results/direct-all.json.gz: the files outside the import graph that revisions of
// 49 or fewer re-keyed files reach, with their median recorded duration. Read-only.
import { DatabaseSync } from "node:sqlite";
import { readResult } from "./graph.mjs";
const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const d = readResult("direct-all");
const per = db.prepare(`select c.project, c.test_path path, r.run_id, sum(r.duration_ms) ms from results r join checks c on c.id = r.check_id group by c.project, c.test_path, r.run_id`).all();
const by = new Map(); for (const r of per) { const id = `${r.project}:${r.path}`; (by.get(id) ?? by.set(id, []).get(id)).push(r.ms / 1000); }
const med = (xs) => { const s = [...(xs ?? [])].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const small = d.filter((o) => o.files.filter((f) => f.cls !== "absent").length <= 49);
const c = new Map();
for (const o of small) for (const f of o.files) if (f.cls === "outside") c.set(f.id, (c.get(f.id) ?? 0) + 1);
console.log(`small revisions (<= 49 re-keyed): ${small.length}; outside files by revisions reached:`);
for (const [id, n] of [...c].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n} ${id} median ${med(by.get(id))?.toFixed(1)} s`);
const tr = new Map();
for (const o of small) for (const f of o.files) if (f.cls === "transitive") tr.set(f.id, (tr.get(f.id) ?? 0) + 1);
console.log(`transitive in small: ${[...tr.values()].reduce((a, b) => a + b, 0)} file slots, ${tr.size} files`);
