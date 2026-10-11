const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const out=[];
for (const r of db.prepare("select id,data from runs").all()) { const w=JSON.parse(r.data).worktreeSetup; if (w?.durationMs!==undefined) out.push([w.startedAt,(w.durationMs/1000).toFixed(1),w.status,w.error??""]); }
out.sort(); for (const o of out) console.log(o.join("  "));
