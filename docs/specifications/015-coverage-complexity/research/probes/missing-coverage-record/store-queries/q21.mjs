import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]);
const rows = s.prepare(`select k.test_path p, r.run_id, (select recorded_at from c.coverage v where v.result_key=r.key) cov
  from results r join checks k on k.id=r.check_id join runs u on u.id=r.run_id
  where k.kind='file' and r.outcome='pass' and u.end_state='completed' and r.recorded_at > ?
  and exists (select 1 from results r2 join checks k2 on k2.id=r2.check_id where r2.run_id=r.run_id and k2.kind='file' and (select 1 from c.coverage v2 where v2.result_key=r2.key))`).all(since);
const by = new Map();
for (const r of rows) { const e = by.get(r.p) ?? { n: 0, miss: 0 }; e.n++; if (r.cov === null) e.miss++; by.set(r.p, e); }
const files = [...by.values()];
console.log("files", files.length, "results", rows.length, "missing", rows.filter(r => r.cov === null).length);
const always = [...by].filter(([, e]) => e.miss === e.n && e.n >= 3).sort((a, b) => b[1].n - a[1].n);
console.log("always missing (n>=3):", always.length, "files,", always.reduce((a, [, e]) => a + e.n, 0), "results");
for (const [p, e] of always.slice(0, 30)) console.log("  ", p, e.n);
const often = [...by].filter(([, e]) => e.miss > 0 && e.miss < e.n);
console.log("sometimes missing:", often.length, "files,", often.reduce((a, [, e]) => a + e.miss, 0), "missing results");
for (const p of process.argv.slice(3)) console.log(p, by.get(p));
