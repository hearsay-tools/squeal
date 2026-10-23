const fs=require("fs");
const parse=(p)=>{const t=fs.readFileSync(p,"utf8"); return JSON.parse(t.slice(t.indexOf("{\n"), t.lastIndexOf("}")+1));};
const [oa,ra,ob,rb]=process.argv.slice(2);
const load=(o,r)=>{const m={}; for (const b of o.batches) { const j=JSON.parse(fs.readFileSync(b.copy,"utf8")).result; m[b.testFiles.join()]=j.filter(s=>s.url.includes("/src/")).map(s=>({u:s.url.replace(r,""),fn:s.functions.map(f=>f.functionName+":"+f.ranges.map(x=>x.startOffset+"-"+x.endOffset+"x"+x.count).join(","))})).sort((x,y)=>x.u<y.u?-1:1);} return m;};
const A=load(parse(oa),ra),B=load(parse(ob),rb);
for (const k of Object.keys(A)) { const x=JSON.stringify(A[k]), y=JSON.stringify(B[k]); console.log(k, x===y); if (x!==y) { console.log(" A", x.slice(0,700)); console.log(" B", y.slice(0,700)); } }
