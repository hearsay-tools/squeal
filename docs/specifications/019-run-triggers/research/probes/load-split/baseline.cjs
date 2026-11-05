// 019-46 probe (throwaway): baseline checkpoints per worktree: first in the window or a later restart; files and recorded s.
const {DatabaseSync}=require("node:sqlite"); const fs=require("fs");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const T0=Date.parse("2026-11-02T16:50:00Z"), T1=Date.parse("2026-11-05T16:50:00Z");
const cps=db.prepare("select * from checkpoints where kind='baseline' order by started_at").all();
const seen=new Map(); const agg={first:{n:0,files:0,sec:0},later:{n:0,files:0,sec:0}}; const files=[];
const runsOf=db.prepare("select * from runs where checkpoint_id=?");
for (const c of cps){ const nth=(seen.get(c.worktree_id)??0); seen.set(c.worktree_id,nth+1); if(c.started_at<T0||c.started_at>=T1) continue;
  let sec=0; for (const r of runsOf.all(c.id)){ try{const rep=JSON.parse(fs.readFileSync(r.log_dir+"/report.json","utf8")).report; for(const d of rep.fileDurations??[]) sec+=d.durationMs/1000;}catch{ if (r.ended_at) sec+=(r.ended_at-r.started_at)/1000; } }
  const a=nth===0?agg.first:agg.later; a.n++; a.files+=JSON.parse(c.test_files).length; a.sec+=sec; files.push(JSON.parse(c.test_files).length);}
files.sort((a,b)=>a-b); console.log(JSON.stringify({agg, filesP50:files[files.length>>1], filesP90:files[Math.floor(files.length*0.9)], max:files.at(-1), n:files.length}));
