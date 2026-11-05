// 019-46 probe (throwaway): stored results in the window by path pattern: file runs with a FAIL result, and distinct (worktree, file) with one.
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true}); const pats=process.argv.slice(3);
const T0=Date.parse("2026-11-02T16:50:00Z"), T1=Date.parse("2026-11-05T16:50:00Z");
const rows=db.prepare(`select r.worktree_id w, r.run_id run, c.project p, c.test_path tp, max(r.outcome='fail') failed from results r join checks c on c.id=r.check_id
  join runs u on u.id=r.run_id where u.started_at>=? and u.started_at<? group by 1,2,3,4`).all(T0,T1);
const out={all:{fileRuns:0,failRuns:0,failPairs:new Set()}}; for (const p of pats) out[p]={fileRuns:0,failRuns:0,failPairs:new Set()};
for (const r of rows){ const name=r.p+" "+r.tp; for (const k of ["all",...pats.filter(p=>new RegExp(p).test(name))]){ const o=out[k]; o.fileRuns++; if(r.failed){o.failRuns++; o.failPairs.add(r.w+name)} } }
for (const [k,o] of Object.entries(out)) console.log(k, o.fileRuns, "fail file runs", o.failRuns, "worktree-files with a FAIL", o.failPairs.size);
