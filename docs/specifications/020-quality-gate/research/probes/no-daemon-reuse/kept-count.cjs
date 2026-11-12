// Throwaway (row 020-38): read-only store count; see README.md.
const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[2],{readOnly:true});
console.log(JSON.stringify({
 filesWithResults: db.prepare("select count(distinct c.project||'/'||c.test_path) n from results r join checks c on c.id=r.check_id").get().n,
 resultKeys: db.prepare("select count(distinct key) n from results").get().n,
 observedMeta: db.prepare("select key, length(value) n from meta where key like 'observed%'").all().map(r=>[r.key,r.n]),
}));
