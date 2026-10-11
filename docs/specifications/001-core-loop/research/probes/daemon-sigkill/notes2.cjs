const {DatabaseSync}=require("node:sqlite");
const [from,to]=process.argv.slice(2,4).map(s=>Date.parse(s));
for (const f of process.argv.slice(4)) {
 const db=new DatabaseSync(f,{readOnly:true});
 for (const r of db.prepare("select key, value from meta where key like 'notes.%'").all()) {
   let arr; try{arr=JSON.parse(r.value)}catch{continue}
   for (const x of arr) if (x.at>=from&&x.at<=to) console.log(f.split("/")[4], r.key, new Date(x.at).toISOString().slice(11,23), x.text.slice(0,300));
 }
}
