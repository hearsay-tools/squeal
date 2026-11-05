// 011-299 probe (throwaway): live-worktree calibration of own uncommitted edits: which closure paths they touched.
// Usage: run from the folder with stores/ and out/: node owned-edits.cjs
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("stores/cezar/store.sqlite",{readOnly:true});
const R=require("fs").readFileSync("out/classes.jsonl","utf8").trim().split("\n").map(JSON.parse);
const F=require("fs").readFileSync("out/firsts.jsonl","utf8").trim().split("\n").map(JSON.parse).filter(x=>!x.summary);
const closure=new Map(); for(const r of db.prepare("select project,path,closure_paths from test_files").all()) closure.set(r.project+"\0"+r.path,new Set(JSON.parse(r.closure_paths)));
const q=db.prepare("select changes from revisions where worktree_id=? and number>? and number<=?");
const cnt=new Map(); let n=0;
R.forEach((r,i)=>{ if(!(r.live&&r.ownDirty==="touched")) return; n++; const x=F[i]; const cl=closure.get(r.file)??new Set();
  const seen=new Set(); for(const row of q.all(r.W,x.ckRev,x.rev)) for(const c of JSON.parse(row.changes)) if(cl.has(c.path)) seen.add(c.path);
  for(const p of seen) cnt.set(p,(cnt.get(p)??0)+r.sec); });
console.log(n); console.log([...cnt].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([p,s])=>Math.round(s)+" "+p).join("\n"));
