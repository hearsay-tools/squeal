const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});
const names=process.argv.slice(3);
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (!names.some((n)=>r.path.endsWith(n))) continue;
  const c=JSON.parse(r.closure_paths); console.log(r.project, r.path, "closure", c.length, "dist", c.filter((p)=>p.startsWith("packages/cezar/dist/")).length);
}
const by={}; for (const r of db.prepare("select project, closure_paths from test_files").all()) { const n=JSON.parse(r.closure_paths).some((p)=>p.startsWith("packages/cezar/dist/")); by[r.project]=by[r.project]||[0,0]; by[r.project][n?1:0]++; } console.log("per project [no dist, dist]:", by);
