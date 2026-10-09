const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
for (const sql of process.argv.slice(3)) { const t=process.hrtime.bigint(); const r=db.prepare(sql).all(); console.log(sql.slice(0,80),"->",Number(process.hrtime.bigint()-t)/1e6,"ms"); console.table(r.slice(0,40)); }
