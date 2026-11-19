// perfile.mjs <store> <T t0> <T t1> <H0 t0> <H0 t1>: per test file, its duration in each arm's runs; ratio stats
import { DatabaseSync } from "node:sqlite"; import { existsSync, readFileSync } from "node:fs"; import { join } from "node:path";
const [store, a0, a1, b0, b1] = process.argv.slice(2); const db = new DatabaseSync(store, { readOnly: true });
const durs = (f, t) => { const m = new Map(); for (const r of db.prepare("select * from runs where started_at>=? and started_at<=?").all(+f, +t)) { const p = join(r.log_dir, "report.json"); if (!existsSync(p)) continue; const rep = JSON.parse(readFileSync(p, "utf8")).report; for (const d of rep.fileDurations ?? []) m.set(d.testFile.project + "|" + d.testFile.path, d.durationMs / 1000); } return m; };
const A = durs(a0, a1), B = durs(b0, b1); const both = [...A.keys()].filter((k) => B.has(k));
const r = both.map((k) => A.get(k) / Math.max(0.05, B.get(k))).sort((x, y) => x - y); const q = (p) => r[Math.floor(p * (r.length - 1))].toFixed(2);
const sum = (m) => both.reduce((a, k) => a + m.get(k), 0);
console.log(JSON.stringify({ files: both.length, sumT: +sum(A).toFixed(0), sumH0: +sum(B).toFixed(0), ratio: { p10: q(0.1), p50: q(0.5), p90: q(0.9) } }));
// keys of one report entry to see what fields exist
const one = db.prepare("select log_dir from runs where started_at>=? and started_at<=? limit 1").get(+a0, +a1); const p = join(one.log_dir, "report.json"); if (existsSync(p)) { const rep = JSON.parse(readFileSync(p, "utf8")).report; console.log(Object.keys(rep), JSON.stringify(rep.fileDurations?.[0])); }
