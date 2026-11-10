// Throwaway (018-21). Which exported closure listings ("dir/") have other entry names on disk than in the commit tree.
// Usage: node key-listings.cjs <export.json> <blobs.tsv> <clone root>
const fs=require("fs"), path=require("path");
const [exp, blobsFile, root] = process.argv.slice(2);
const b=JSON.parse(fs.readFileSync(exp));
const names=new Map();
for (const l of fs.readFileSync(blobsFile,"utf8").trim().split("\n")) { const p=l.split("\t")[1]; let d=""; for (const n of p.split("/")) { if(!names.has(d)) names.set(d,new Set()); names.get(d).add(n); d=d?d+"/"+n:n; } }
const lists=new Map(), files=new Map();
for (const f of b.testFiles) { let any=false; for (const p of f.closure?.paths||[]) { if(!p.endsWith("/")) continue; const d=p.slice(0,-1);
  const c=names.get(d); let l=null; try { l=new Set(fs.readdirSync(path.join(root,d))); } catch {}
  const cs=c?[...c].sort().join(","):"ABSENT", ls=l?[...l].sort().join(","):"ABSENT";
  if (cs!==ls) { any=true; const extra=l?[...l].filter(x=>!c?.has(x)):[]; const miss=c?[...c].filter(x=>!l?.has(x)):[]; lists.set(p+" local-extra=["+extra.join(",")+"] local-missing=["+miss.join(",")+"]",(lists.get(p)||0)+1); } }
  if(any) files.set(f.project,(files.get(f.project)||0)+1); }
console.log("files with a differing listing:", JSON.stringify([...files]));
for (const [k] of [...lists].slice(0,30)) console.log(k);
const all=new Map(); for (const f of b.testFiles) for (const p of f.closure?.paths||[]) if (p.endsWith("/")) all.set(f.project,(all.get(f.project)||0)+1);
console.log("listing entries per project:", JSON.stringify([...all]));
