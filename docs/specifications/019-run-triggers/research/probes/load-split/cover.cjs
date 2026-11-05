// coverage of run worktrees by transcripts (019-46 probe, throwaway)
const {DatabaseSync}=require("node:sqlite"); const fs=require("fs");
const T=JSON.parse(fs.readFileSync(process.argv[3])).worktrees;
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const since=Date.parse("2026-11-02T16:50:00Z");
const runs=db.prepare("select worktree_id w, count(*) n from runs where started_at>=? group by 1").all(since);
const revW=new Set(db.prepare("select distinct worktree_id w from revisions").all().map(r=>r.w));
let a={runsWT:runs.length, withRevs:0, withTranscript:0, neither:0, runsNeither:0, transcriptOnly:0};
for (const r of runs){const t=T[r.w]; if(revW.has(r.w))a.withRevs++; if(t)a.withTranscript++; if(!revW.has(r.w)&&!t){a.neither++;a.runsNeither+=r.n} if(!revW.has(r.w)&&t)a.transcriptOnly++;}
console.log(a);
let e=0,s=0; for (const v of Object.values(T)){e+=v.edits.length;s+=v.stops.length} console.log("edits",e,"stops",s);
