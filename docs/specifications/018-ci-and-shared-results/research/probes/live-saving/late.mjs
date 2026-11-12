import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const med = JSON.parse(readFileSync('local.json','utf8')).medianFileMs;
const db = new DatabaseSync('/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const cutoff = Date.parse('2026-11-12T14:45:00Z');
const W = [['B',Date.parse('2026-11-10T21:49:00Z')],['C',Date.parse('2026-11-11T19:00:00Z')],['D',Date.parse('2026-11-12T09:19:00Z')],['E',Date.parse('2026-11-12T13:21:00Z')]];
const win = t => [...W].reverse().find(w => t >= w[1])[0];
const rows = db.prepare(`select i.imported_at at, f.project, f.path, f.key, r.worktree_id wt, r.recorded_at rec, r.last_used_at used, r.duration_ms ms
 from import_files f join imports i on i.id=f.import_id join checks c on c.kind='file' and c.project=f.project and c.test_path=f.path
 join results r on r.check_id=c.id and r.key=f.key where i.imported_at < ?`).all(cutoff);
const late = new Map(), used = new Map();
for (const r of rows) {
  const id = r.project+'\0'+r.path+'\0'+r.key;
  if (!r.wt.startsWith('import:') && r.rec < r.at) { if (!late.has(id) || late.get(id).at > r.at) late.set(id, r); }
  if (r.wt.startsWith('import:') && r.used > r.rec) used.set(id, r);
}
const sum = (m) => { const o = {}; for (const [id, r] of m) { const w = win(r.at); const e = o[w] ??= {files:0, medSec:0}; e.files++; e.medSec += (med[r.project+'\0'+r.path] ?? r.ms)/1000; } for (const e of Object.values(o)) e.medSec = Math.round(e.medSec); return o; };
console.log('late (local row before the first import that carried the key), by window of that import:', sum(late));
console.log('used (import row looked up), by window of the import:', sum(used));
const lw = {}; for (const r of late.values()) lw[r.wt.slice(0,8)] = (lw[r.wt.slice(0,8)] ?? 0) + 1; console.log('late by worktree', lw);
