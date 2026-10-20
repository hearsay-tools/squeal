const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2], { readOnly: true });
const q=(s,...a)=>db.prepare(s).all(...a);
console.log("file_hashes dist per worktree:");
for (const r of q(`select w.root, sum(path like '%.d.ts') dts, sum(path like '%.js.map') map, sum(path like '%.js') js, sum(path not like '%.d.ts' and path not like '%.js.map' and path not like '%.js') other from file_hashes f join worktrees w on w.id=f.worktree_id where path like 'packages/cezar/dist/%' group by f.worktree_id`)) console.log(' ', r.root.replace(/.*\//,''), r.dts, r.map, r.js, r.other);
const kinds={}; let files=0;
for (const r of q("select project, path, closure_paths, method from test_files")) {
  for (const p of JSON.parse(r.closure_paths)) {
    if (!p.includes('dist/')) continue;
    const k = r.project+' '+r.method+' '+(p.endsWith('.d.ts')?'d.ts':p.endsWith('.js.map')?'map':p.endsWith('.js')?'js':'other');
    kinds[k]=(kinds[k]??0)+1;
  }
}
console.log("closure dist paths by project/method/kind:", kinds);
// revisions naming dist .d.ts
let n=0, ex=null;
for (const r of q("select worktree_id, number, trigger, changes, created_at from revisions where changes like '%packages/cezar/dist/%'")) { n++; ex ??= {trigger:r.trigger, at:new Date(r.created_at).toISOString(), sample: JSON.parse(r.changes).filter(c=>String(c.path).includes('dist/')).slice(0,3)}; }
console.log("revisions naming dist:", n, JSON.stringify(ex));
