// cost of an edit to <path>: test files whose closure holds it, and their last durations
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});const fs=require("fs");
const dur=new Map();for(const r of db.prepare("select c.project p,c.test_path t,(select duration_ms from results r where r.check_id=c.id order by recorded_at desc limit 1) d from checks c").all())if(r.d!=null){const k=r.p+"\0"+r.t;dur.set(k,(dur.get(k)||0)+r.d)}
const tfs=db.prepare("select project,path,closure_paths from test_files").all();
for(const target of process.argv.slice(3)){let n=0,s=0,unk=0;const per={};for(const t of tfs){const c=JSON.parse(t.closure_paths);if(t.path===target||c.includes(target)){n++;const d=dur.get(t.project+"\0"+t.path);if(d==null)unk++;else{s+=d;const top=t.path.split("/").slice(0,2).join("/");per[top]=(per[top]||0)+d}}}
console.log(target,"files",n,"sum s",(s/1000).toFixed(0),"no dur",unk,JSON.stringify(Object.entries(per).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>[k,Math.round(v/1000)])))}
