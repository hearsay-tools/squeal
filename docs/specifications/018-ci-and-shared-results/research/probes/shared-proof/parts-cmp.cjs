// Throwaway (018-21). Classifies the test files of downloaded `squeal ci record` parts by why an export would leave them out,
// comparing each recorded input's evidence with the commit tree. Usage: node parts-cmp.cjs <parts dir> <blobs.tsv>
// For each recorded test file: which of its observed file paths have evidence that is not the commit's blob.
const fs=require("fs"), path=require("path");
const [dir, blobsFile] = process.argv.slice(2);
const blobs=new Map(fs.readFileSync(blobsFile,"utf8").trim().split("\n").map(l=>{const [h,p]=l.split("\t");return [p,h]}));
const parts=fs.readdirSync(dir,{recursive:true}).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
const kinds=new Map(), files=new Map(); let total=0, dupNames=0;
for (const p of parts) for (const f of p.testFiles) { total++;
  const names=f.checks.map(c=>c.fullName??c.name); if (new Set(names).size!==names.length) dupNames++;
  const bad=[];
  for (const q of f.observed.paths) { if (!(q in p.evidence)) { bad.push(["no evidence", q]); continue; }
    const e=p.evidence[q], c=blobs.get(q)??null;
    if (e===c) continue;
    bad.push([e===null?"absent in run, tracked at commit":c===null?"present in run, not tracked at commit":"tracked, other content in run", q]); }
  if (bad.length) { const k=[...new Set(bad.map(b=>b[0]))].sort().join(" + "); files.set(k,(files.get(k)||[]).concat([f.project+":"+f.path+" <- "+bad.slice(0,3).map(b=>b[1]).join(", ")+(bad.length>3?" (+"+(bad.length-3)+")":"")])); for (const b of bad) kinds.set(b[0]+" "+b[1],(kinds.get(b[0]+" "+b[1])||0)+1); }
}
console.log("recorded test files:", total, " with two checks of one name (by fullName):", dupNames);
for (const [k,v] of files) { console.log(`\n${v.length} files: ${k}`); for (const x of v.slice(0,6)) console.log("  "+x); }
console.log("\nmost common paths:"); for (const [k,n] of [...kinds].sort((a,b)=>b[1]-a[1]).slice(0,25)) console.log(n, k);

// Directory listings: evidence (names hash at listing) against the commit tree's names plus the export
// checkout's untracked top-level entries we know of (node_modules, dist) — approximate.
const crypto=require("crypto");
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const nh=(ns)=>crypto.createHash("sha1").update([...ns].sort(cmp).join("\0")).digest("hex");
const names=new Map(); for (const p of blobs.keys()) { let d=""; for (const n of p.split("/")) { if(!names.has(d)) names.set(d,new Set()); names.get(d).add(n); d=d?d+"/"+n:n; } }
const dirFiles=new Map(); const dirKinds=new Map();
for (const p of parts) for (const f of p.testFiles) {
  const bad=[];
  for (const q of f.observed.directories ?? []) { const e=p.evidence[q.endsWith("/")?q:q+"/"]; const d=q.replace(/\/$/,""); const c=names.get(d);
    if (e===undefined) { bad.push("no evidence "+q); continue; }
    if (c===undefined) { if (e!==null) bad.push("listed in run, no such dir at commit "+q); continue; }
    if (e!==nh(c)) bad.push("names differ "+q); }
  if (bad.length) { dirFiles.set(f.project+":"+f.path, bad); for (const b of bad) dirKinds.set(b,(dirKinds.get(b)||0)+1); }
}
console.log("\nfiles with a listing whose evidence is not the commit tree's names:", dirFiles.size);
for (const [k,n] of [...dirKinds].sort((a,b)=>b[1]-a[1]).slice(0,20)) console.log(n, k);

// Writes, recursive listings, shared names, duplicate check names (fullName + location), union of reasons.
const why=new Map();
const add=(id,r)=>{ if(!why.has(id)) why.set(id,new Set()); why.get(id).add(r); };
for (const p of parts) for (const f of p.testFiles) { const id=f.project+":"+f.path;
  for (const q of f.observed.paths) { const e=p.evidence[q], c=blobs.get(q)??null; if (!(q in p.evidence)) add(id,"input with no evidence"); else if (e!==c) add(id,"input other than commit"); }
  if ((f.observed.written??[]).length) add(id,"wrote a path ("+f.observed.written.slice(0,2).join(", ")+")");
  if ((f.observed.recursive??[]).length) add(id,"recursive listing");
  if (f.sharedNames) add(id,"sharedNames "+JSON.stringify(f.sharedNames).slice(0,60));
  const names=f.checks.map(c=>c.fullName); if (new Set(names).size!==names.length) add(id,"two checks of one name");
}
const combo=new Map(); for (const [id,rs] of why) { const k=[...rs].map(r=>r.replace(/ \(.*/,"")).sort().join(" + "); combo.set(k,(combo.get(k)||0)+1); }
console.log("\nfiles by reason set:"); for (const [k,n] of [...combo].sort((a,b)=>b[1]-a[1])) console.log(n, k);
const wr=new Map(); for (const p of parts) for (const f of p.testFiles) for (const w of f.observed.written??[]) wr.set(w.replace(/[A-Za-z0-9]{6}(?=\/|$)/g,"*"),(wr.get(w)||0)+1);
console.log("\nwritten paths (top):"); for (const [k,n] of [...wr].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(n,k);
