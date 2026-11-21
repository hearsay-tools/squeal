const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[2],{readOnly:true});
const pub={9:"2026-11-21T05:32:27Z",11:"2026-11-21T07:51:32Z",13:"2026-11-21T08:45:07Z"};
for (const [rev,p] of Object.entries(pub)) {
  const runs=db.prepare("select started_at s, json_array_length(test_files) n from runs where worktree_id='25fc5639a9bd0aaf' and revision=?").all(Number(rev));
  const t=Date.parse(p)+30000; const tot=runs.reduce((a,r)=>a+r.n,0);
  console.log(JSON.stringify({revision:Number(rev), publishDone:p, files:tot, startedBeforePublishPlus30s: runs.filter(r=>r.s<t).reduce((a,r)=>a+r.n,0), firstStart:new Date(Math.min(...runs.map(r=>r.s))).toISOString()}));
}
