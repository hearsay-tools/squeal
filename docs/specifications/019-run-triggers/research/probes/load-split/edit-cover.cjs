// 019-46 probe (throwaway): transcript edits against store watch revisions, for worktrees whose revisions the store kept.
const {DatabaseSync}=require("node:sqlite"); const fs=require("fs");
const T=JSON.parse(fs.readFileSync(process.argv[3])).worktrees;
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const since=Date.parse("2026-11-02T16:50:00Z");
const revs=db.prepare("select worktree_id w, created_at t, changes from revisions where trigger='watch' and created_at>=?").all(since);
const by=new Map(); for (const r of revs){(by.get(r.w)??by.set(r.w,[]).get(r.w)).push(r)}
let tot=0, matched=0, tEdits=0;
for (const [w,list] of by){const t=T[w]; const ed=t?t.edits.filter(e=>e[0]>=since):[]; tEdits+=ed.length;
 for (const r of list){tot++; const paths=JSON.parse(r.changes).map(c=>c.path); if (ed.some(([et,p])=>Math.abs(et-r.t)<15000 && paths.includes(p))) matched++;}}
console.log({worktrees:by.size, watchRevisions:tot, withTranscriptEditWithin15s:matched, transcriptEdits:tEdits});
