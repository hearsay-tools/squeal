import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]);
const runs = s.prepare(`select id, worktree_id w, ended_at from runs where end_state='completed' and ended_at > ?`).all(since);
const res = s.prepare(`select k.test_path p, r.outcome o, (select recorded_at from c.coverage v where v.result_key=r.key) cov from results r join checks k on k.id=r.check_id where r.run_id=? and k.kind='file'`);
const inside = s.prepare("select count(*) n from c.coverage where recorded_at > ? and recorded_at < ?");
const blocks = []; let unboundedFiles = 0, boundedFiles = 0;
for (const u of runs) {
  const rs = res.all(u.id);
  if (!rs.some(r => r.cov !== null)) continue;
  if (!rs.some(r => r.cov === null && r.o === "pass")) continue;
  const log = `${dir}runs/${u.id}/vitest.log`;
  if (!existsSync(log)) continue;
  const by = new Map(rs.map(r => [r.p, r]));
  const seq = [...readFileSync(log, "utf8").matchAll(/^MODULE \w+ (.+)$/gm)].map(m => by.get(m[1])).filter(Boolean);
  let i = 0;
  while (i < seq.length) {
    if (seq[i].cov !== null) { i++; continue; }
    let j = i; while (j < seq.length && seq[j].cov === null) j++;
    const n = seq.slice(i, j).filter(r => r.o === "pass").length;
    const prev = i > 0 ? seq[i-1].cov : null, next = j < seq.length ? seq[j].cov : null;
    if (prev !== null && next !== null && next > prev && n > 0) {
      boundedFiles += n;
      const perJob = (next - prev) / (j - i + 1) / 1000;
      const others = (next - prev) > 4000 ? inside.get(prev + 1500, next - 1500).n : null;
      blocks.push({ n, perJob, others, span: (next - prev) / 1000 });
    } else unboundedFiles += n;
    i = j;
  }
}
const bucket = (x) => x < 0.5 ? "<0.5 s" : x < 1.8 ? "0.5-1.8 s" : x < 3.5 ? "1.8-3.5 s (busy signature)" : "3.5 s+";
const t = {};
for (const b of blocks) { const k = bucket(b.perJob); t[k] ??= { blocks: 0, files: 0, zeroOthers: 0, checked: 0 }; t[k].blocks++; t[k].files += b.n; if (b.others !== null) { t[k].checked++; if (b.others === 0) t[k].zeroOthers++; } }
console.log({ boundedFiles, unboundedFiles });
for (const [k, v] of Object.entries(t)) console.log(k.padEnd(28), JSON.stringify(v));
