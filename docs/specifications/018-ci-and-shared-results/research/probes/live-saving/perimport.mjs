import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const imps = db.prepare("select id, imported_at, json_extract(header,'$.squealVersion') v, substr(json_extract(header,'$.commit'),1,8) c from imports order by imported_at").all();
const env = new Map(db.prepare("select hash, descriptor from environments").all().map(r => [r.hash, JSON.parse(r.descriptor)]));
const q = db.prepare(`select count(distinct c.project||c.test_path) files, count(*) rows,
  count(distinct case when r.last_used_at > r.recorded_at then c.project||c.test_path end) used,
  min(case when r.last_used_at > r.recorded_at then r.last_used_at end) firstuse
  from results r join checks c on c.id=r.check_id where r.worktree_id = ?`);
const qf = db.prepare(`select environment, count(*) n from import_files where import_id=? group by 1`);
console.log('imported_at\tci_ver\tcommit\texported\trekeyed_env(node,adapter)\tfiles_held\tfiles_looked_up\tfirst_lookup_min');
for (const i of imps) {
  const r = q.get('import:' + i.id);
  const envs = qf.all(i.id).map(e => { const d = env.get(e.environment); return `${d?.project ?? '?'}:${d?.nodeVersion ?? '?'}/${d?.adapterVersion ?? '?'}=${e.n}`; }).join(' ');
  const exported = qf.all(i.id).reduce((a, e) => a + e.n, 0);
  console.log([new Date(i.imported_at).toISOString().slice(0,16), i.v, i.c, exported, envs, r.files, r.used, r.firstuse ? ((r.firstuse - i.imported_at)/60000).toFixed(1) : '-'].join('\t'));
}
