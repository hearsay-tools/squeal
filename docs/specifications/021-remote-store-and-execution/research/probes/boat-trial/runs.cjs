// Throwaway: runs since a time, with the daemon's run time, Vitest's own time and where it ran.
const {DatabaseSync}=require("node:sqlite"); const fs=require("fs");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
for (const r of db.prepare("select revision, json_array_length(test_files) n, log_dir, started_at, ended_at from runs where started_at > ? order by started_at").all(Date.parse(process.argv[3]))) {
  let d="-", w="";
  try { w=fs.readdirSync(r.log_dir).includes("here")?"here":"remote"; const p=w==="here"?r.log_dir+"/here":r.log_dir; const j=JSON.parse(fs.readFileSync(p+"/report.json","utf8")); d=Math.round((j.report??j).durationMs); } catch(e){}
  console.log(new Date(r.started_at).toISOString().slice(11,23),"rev",r.revision,"files",r.n,"run_ms",r.ended_at-r.started_at,"vitest_ms",d,w);
}
