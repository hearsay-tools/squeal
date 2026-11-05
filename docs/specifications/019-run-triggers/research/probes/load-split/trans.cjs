// 019-46 probe (throwaway): test files that turned to FAIL or to PASS in the window, by path pattern (distinct worktree+file+kind).
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true}); const pats=process.argv.slice(3);
const T0=Date.parse("2026-11-02T16:50:00Z"), T1=Date.parse("2026-11-05T16:50:00Z");
const rows=db.prepare("select t.worktree_id w, t.from_outcome f, t.to_outcome o, c.project p, c.test_path tp from transitions t join checks c on c.id=t.check_id where t.at>=? and t.at<?").all(T0,T1);
const seen=new Set(); const all={toFail:0,toPass:0}; const per=Object.fromEntries(pats.map(p=>[p,{toFail:0,toPass:0}]));
for (const r of rows){const kind=r.o==="fail"&&r.f!=="fail"?"toFail":r.f==="fail"&&r.o==="pass"?"toPass":null; if(!kind) continue; const k=r.w+r.p+r.tp+kind; if(seen.has(k)) continue; seen.add(k); all[kind]++; for (const p of pats) if(new RegExp(p).test(r.p+" "+r.tp)) per[p][kind]++;}
console.log(JSON.stringify({all,per}));
