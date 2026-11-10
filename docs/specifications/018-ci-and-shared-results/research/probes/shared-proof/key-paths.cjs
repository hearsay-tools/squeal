// Throwaway (018-21). Which exported closure file paths have a local hash (store file_hashes, or the file on disk) other than the commit blob.
// Usage: node key-paths.cjs <export.json> <clone store.sqlite> <blobs.tsv from git ls-tree -r> <clone root>
const fs=require("fs"); const {DatabaseSync}=require("node:sqlite");
const [exp, db, blobsFile, root] = process.argv.slice(2); const path=require("path");
const b=JSON.parse(fs.readFileSync(exp));
const blobs=new Map(fs.readFileSync(blobsFile,"utf8").trim().split("\n").map(l=>{const [h,p]=l.split("\t");return [p,h]}));
const d=new DatabaseSync(db,{readOnly:true});
const local=new Map(d.prepare("select path, hash from file_hashes").all().map(r=>[r.path,r.hash]));
const diff=new Map(); const filesWith=new Map();
for (const f of b.testFiles){ let any=false;
  for (const p of f.closure?.paths||[]) { if (p.endsWith("/")) continue;
    const c=blobs.get(p)??null, l=local.has(p)?local.get(p):(fs.existsSync(path.join(root,p))?"(exists, not hashed)":null);
    if (c!==l) { const k=p+" commit="+(c??"absent").slice(0,10)+" local="+String(l).slice(0,12); diff.set(k,(diff.get(k)||0)+1); any=true; } }
  if (any) filesWith.set(f.project,(filesWith.get(f.project)||0)+1);
}
console.log("files with a differing file path:", JSON.stringify([...filesWith]));
console.log([...diff].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,n])=>n+" "+k).join("\n"));
