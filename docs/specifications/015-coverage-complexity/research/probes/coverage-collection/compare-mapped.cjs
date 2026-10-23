const fs=require("fs");
const parse=(p)=>{const t=fs.readFileSync(p,"utf8"); return JSON.parse(t.slice(t.indexOf("{\n"), t.lastIndexOf("}")+1));};
const [oa,ob]=process.argv.slice(2);
const load=(o)=>{const m={}; for (const b of o.batches) { const j=JSON.parse(fs.readFileSync(b.copy+".istanbul.json","utf8")); m[b.testFiles.join()]=JSON.stringify(Object.keys(j).sort().map(k=>j[k])); } return m;};
const A=load(parse(oa)),B=load(parse(ob));
for (const k of Object.keys(A)) { const x=A[k], y=B[k]; console.log(k, x===y); if (x!==y) { let i=0; while (x[i]===y[i]) i++; console.log(" A", x.slice(i-200,i+200)); console.log(" B", y.slice(i-200,i+200)); } }
