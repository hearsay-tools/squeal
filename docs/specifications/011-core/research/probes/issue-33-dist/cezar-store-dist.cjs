const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2], { readOnly: true });
for (const r of db.prepare(`select f.worktree_id w, w.root, sum(path like '%.d.ts') dts, sum(path like '%.js.map') map, sum(path like '%.js') js from file_hashes f join worktrees w on w.id=f.worktree_id where path like 'packages/cezar/dist/%' group by f.worktree_id`).all()) console.log(r);
const s=new Set(), j=new Set(); for(const r of db.prepare("select closure_paths from test_files").all()) for(const p of JSON.parse(r.closure_paths)) if(p.startsWith("packages/cezar/dist/")) (p.endsWith(".js")?j:s).add(p);
console.log("dist .js in any closure:", j.size, "non-js:", s.size, [...s].slice(0,5));
