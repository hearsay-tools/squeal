const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});const repo=process.argv[3];const re=new RegExp(process.argv[4]);const fs=require("fs");
const n=new Map();
for(const t of db.prepare("select project,path,closure_paths from test_files").all()){if(!fs.existsSync(repo+"/"+t.path))continue;for(const p of JSON.parse(t.closure_paths))if(p!==t.path&&re.test(p))n.set(p,(n.get(p)||0)+1)}
const a=[...n].filter(([p])=>fs.existsSync(repo+"/"+p)).sort((x,y)=>x[1]-y[1]);
const q=(f)=>a[Math.floor(f*(a.length-1))];
console.log(a.length,"min",q(0),"p10",q(.1),"p25",q(.25),"p50",q(.5),"p75",q(.75),"p90",q(.9),"max",q(1));
console.log(JSON.stringify(a.filter(([,c])=>c<=3).slice(0,12)));
