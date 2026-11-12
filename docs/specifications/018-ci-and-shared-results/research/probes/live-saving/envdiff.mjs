import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const imp = db.prepare("select id from imports order by imported_at desc limit 1").get().id;
const ie = db.prepare("select environment, count(*) n from import_files where import_id=? and project='server' group by 1 order by n desc").all(imp);
console.log('newest import', imp, ie);
const flat = (o, p='') => Object.entries(o).flatMap(([k,v]) => v && typeof v === 'object' ? flat(v, p+k+'.') : [[p+k, v]]);
const desc = h => JSON.parse(db.prepare("select descriptor from environments where hash=?").get(h)?.descriptor ?? 'null');
const a = desc(ie[0].environment);
for (const w of db.prepare("select w.worktree_id wt, w.hash, wt.daemon_version v from worktree_environment_hashes w join worktrees wt on wt.id=w.worktree_id where w.project='server' and wt.daemon_heartbeat_at > 1794260000000").all()) {
  const b = desc(w.hash);
  const fa = Object.fromEntries(flat(a)), fb = Object.fromEntries(flat(b ?? {}));
  const diff = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(k => fa[k] !== fb[k]);
  console.log(w.wt.slice(0,8), w.v, w.hash === ie[0].environment ? 'SAME' : diff.map(k => `${k}: ${String(fa[k]).slice(0,12)} vs ${String(fb[k]).slice(0,12)}`).join('; '));
}
