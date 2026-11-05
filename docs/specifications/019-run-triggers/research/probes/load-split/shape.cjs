// 019-46 probe (throwaway): run sizes and checkpoint kinds in the window.
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const T0=Date.parse("2026-11-02T16:50:00Z"), T1=Date.parse("2026-11-05T16:50:00Z");
const runs=db.prepare("select r.*, c.kind ck from runs r left join checkpoints c on c.id=r.checkpoint_id where r.started_at>=? and r.started_at<?").all(T0,T1);
const h={}; for (const r of runs){const n=JSON.parse(r.test_files).length; const b=r.ck?("cp:"+r.ck):(n<=4?"<=4":n<=20?"5-20":n<=100?"21-100":">100"); h[b]=(h[b]??0)+1} console.log(runs.length,h);
console.log(db.prepare("select kind, count(*) n, count(distinct worktree_id) w from checkpoints where started_at>=? group by 1").all(T0));
