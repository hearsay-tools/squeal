// Throwaway (row 020-38): read-only store count; see README.md.
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const obs=JSON.parse(db.prepare("select value from meta where key='observed.'").get().value);
const r=JSON.parse(fs.readFileSync(process.argv[3]));
const ran=r.runs.flatMap(x=>x.selected.filter(p=>x.from?.[p]!=="store"));
const o=new Set(Object.keys(obs).filter(k=>obs[k].length));
const both=ran.filter(p=>o.has(p)).length;
const sizes=Object.values(obs).map(v=>v.length).sort((a,b)=>a-b);
const kinds={};for(const v of Object.values(obs))for(const p of v){const k=p.startsWith("test/fixtures")?"test/fixtures":p.split("/").slice(0,2).join("/");kinds[k]=(kinds[k]||0)+1}
console.log(JSON.stringify({ranInA2:ran.length,observedInB:o.size,both,onlyA2:ran.filter(p=>!o.has(p)),medianPaths:sizes[sizes.length>>1],maxPaths:sizes.at(-1),topDirs:Object.entries(kinds).sort((a,b)=>b[1]-a[1]).slice(0,8)}));
