// Throwaway (018-21). Read-only SQL on a throwaway clone's store: node q.cjs <store.sqlite> "<select ...>" [width]
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const sql=process.argv[3];
for (const r of db.prepare(sql).all()) console.log(JSON.stringify(r).slice(0, Number(process.argv[4]||400)));
