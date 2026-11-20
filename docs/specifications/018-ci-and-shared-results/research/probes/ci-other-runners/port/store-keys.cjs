const {DatabaseSync}=require("node:sqlite"); const zlib=require("node:zlib");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const a=JSON.parse(zlib.gunzipSync(require("fs").readFileSync(process.argv[3])));
const ak=new Map(a.testFiles.map(f=>[f.project+"|"+f.path,f.key]));
const rows=db.prepare("select project,path,key from test_file_keys").all();
let eq=0,ne=[],nt=0;
for (const r of rows){const k=ak.get(r.project+"|"+r.path); if(k===undefined) continue; nt++; if(k===r.key) eq++; else ne.push(r.path);}
console.log(`node:test files with a key in B: ${nt}, equal to A: ${eq}, differ: ${ne.length}`, ne);
