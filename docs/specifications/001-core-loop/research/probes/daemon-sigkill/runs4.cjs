const {DatabaseSync}=require("node:sqlite");
const re=new RegExp(process.argv[2]);
for (const f of process.argv.slice(3)) {
 const db=new DatabaseSync(f,{readOnly:true});
 for (const r of db.prepare("select id,created_at,status,worktree_path,data from runs").all()) {
   const hits=[...r.data.matchAll(/"([A-Za-z]+)":"(2026-10-09T[0-9:.]+)Z?"/g)].filter(m=>re.test(m[2])).map(m=>m[1]+"="+m[2].slice(11,23));
   const ws=JSON.parse(r.data).worktreeSetup;
   if (hits.length) console.log(f.split("/")[4],r.id.slice(0,8),r.status,r.created_at, hits.slice(0,8).join(" "), ws?JSON.stringify(ws):"");
 }
}
