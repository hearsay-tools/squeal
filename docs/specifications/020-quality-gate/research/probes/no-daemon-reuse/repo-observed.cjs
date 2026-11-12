// Throwaway (row 020-38): read-only store count; see README.md. node repo-observed.cjs <store> <checkout>
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");const db=new DatabaseSync(process.argv[2],{readOnly:true});
const o=JSON.parse(db.prepare("select value from meta where key='observed.'").get().value);
const nz=Object.keys(o).filter(k=>o[k].length>0);const exist=nz.filter(k=>fs.existsSync(process.argv[3]+"/"+k));
console.log(JSON.stringify({entries:Object.keys(o).length,nonEmpty:nz.length,nonEmptyExistingAt93e3:exist.length}));
