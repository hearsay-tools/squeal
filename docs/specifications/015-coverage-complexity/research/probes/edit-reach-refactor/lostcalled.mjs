// (source, test) pairs called at main whose reach the candidate lost: which functions ran
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync, constants } from "node:zlib";
const b = (await import("/tmp/er112/out-main-static.json", { with: { type: "json" } })).default;
const a = (await import("/tmp/er112/out-cand-static.json", { with: { type: "json" } })).default;
const db = new DatabaseSync("/tmp/er112/stores/store.sqlite", { readOnly: true });
const code = new DatabaseSync("/tmp/er112/stores/code.sqlite", { readOnly: true });
const keyTest = new Map();
for (const r of db.prepare("select distinct r.key k, c.test_path t from results r join checks c on c.id = r.check_id where c.kind = 'file'").all()) keyTest.set(r.k, r.t);
const newest = new Map();
for (const r of code.prepare("select result_key k, recorded_at a from coverage where provider_version = 3").all()) { const t = keyTest.get(r.k); if (!t) continue; const n = newest.get(t); if (!n || n.a < r.a) newest.set(t, r); }
const get = code.prepare("select record from coverage where result_key = ?"), getPart = code.prepare("select part from coverage_parts where id = ?");
const ranFns = (src) => (src.functions ?? []).filter((f) => f[4] === 1 && !(f[0] === 1 && f[1] === 0));
function record(t) { const r = newest.get(t); if (!r) return null; const rec = JSON.parse(inflateRawSync(get.get(r.k).record).toString("utf8")); const m = new Map();
  for (const s of rec.sources ?? []) m.set(s.path, s);
  if (Array.isArray(rec.parts)) { let at = 0, id = 0; for (let i = 0; i < rec.parts.length; i += 2) { at += rec.parts[i]; id += rec.parts[i + 1];
    const bl = getPart.get(id)?.part; if (!bl) continue; const s = JSON.parse(inflateRawSync(bl, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")); if (s.path === rec.unread[at]) m.set(s.path, s); } }
  return { m, at: r.a }; }
const bfs = (g, s) => { const seen = new Set([s]); const q = [s]; while (q.length) { const x = q.pop(); for (const y of g[x]?.v ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } } return seen; };
const sources = new Set(process.argv.slice(2));
const lost = new Map(); let total = 0;
for (const [t, info] of Object.entries(b.testSec)) {
  if (info.m || !info.s) continue;
  const rb = bfs(b.graph, t), ra = bfs(a.graph, t);
  const gone = [...rb].filter((p) => !ra.has(p) && p in a.graph && !(p in b.testSec) && (!sources.size || sources.has(p)));
  if (!gone.length) continue;
  const rec = record(t); if (!rec) continue;
  for (const p of gone) { const s = rec.m.get(p); if (!s) continue; const fns = ranFns(s); if (!fns.length) continue;
    total += info.s; const k = p; const e = lost.get(k) ?? lost.set(k, { sec: 0, n: 0, fns: new Map(), ex: t, at: rec.at }).get(k); e.sec += info.s; e.n++;
    for (const f of fns) { const fk = f[2] ?? `${f[0]}:${f[1]}`; e.fns.set(fk, (e.fns.get(fk) ?? 0) + 1); } }
}
console.log("called pair-s lost on sources the candidate keeps:", Math.round(total));
for (const [p, e] of [...lost].sort((x, y) => y[1].sec - x[1].sec).slice(0, 12)) console.log(Math.round(e.sec), e.n, p, JSON.stringify([...e.fns].slice(0, 4)), "e.g.", e.ex, new Date(e.at).toISOString());
