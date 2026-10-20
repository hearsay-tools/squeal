const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2], { readOnly: true });
const q=(s,...a)=>db.prepare(s).all(...a);
const byDay={};
for (const r of q("select w.root, r.number, r.trigger, r.changes, r.created_at from revisions r join worktrees w on w.id=r.worktree_id where changes like '%packages/cezar/dist/%.d.ts%'")) {
  const day=new Date(r.created_at).toISOString().slice(0,13);
  const ch=JSON.parse(r.changes); const d=ch.filter(c=>c.path.startsWith('packages/cezar/dist/'));
  const k=day+' '+r.trigger; byDay[k]=(byDay[k]??'')+` ${r.root.replace(/.*\//,'').slice(0,12)}#${r.number}(${d.length}/${ch.length})`;
}
for (const k of Object.keys(byDay).sort()) console.log(k, byDay[k].slice(0,200));
for (const r of q("select root, daemon_version, daemon_started_at from worktrees where daemon_version is not null")) console.log(r.root.replace(/.*\//,''), r.daemon_version, r.daemon_started_at && new Date(r.daemon_started_at).toISOString());
const other=new Set(); for(const r of q("select closure_paths from test_files where project='test:package'")) for(const p of JSON.parse(r.closure_paths)) if(p.includes('dist/') && !p.endsWith('.js')) other.add(p);
console.log('test:package non-.js dist closure paths:', [...other].slice(0,8), other.size);
console.log('test_files test:package rows:', q("select count(*) n, max(updated_at) u from test_files where project='test:package'").map(r=>[r.n,new Date(r.u).toISOString()]));
