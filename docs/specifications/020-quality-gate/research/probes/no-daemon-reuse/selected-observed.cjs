// Throwaway (row 020-38): read-only store count; see README.md.
// selected files of a gate report that the given store's observed. row names, with how many paths
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const obs=JSON.parse(db.prepare("select value from meta where key='observed.'").get()?.value??"{}");
const r=JSON.parse(fs.readFileSync(process.argv[3]));
const sel=r.runs.flatMap(x=>x.selected);
const w=sel.filter(p=>(obs[p]??[]).length>0);
const n=w.map(p=>obs[p].length).sort((a,b)=>a-b);
console.log(JSON.stringify({selected:sel.length,withObserved:w.length,medianPaths:n[Math.floor(n.length/2)]??0,storeEntries:Object.keys(obs).length}));
