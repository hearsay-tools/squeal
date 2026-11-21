const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync(process.argv[2],{readOnly:true});
console.log(db.prepare("select sql from sqlite_master where name='test_files'").get().sql);
const ff=Date.parse("2026-11-21T10:17:48.856Z");
const ran=new Set(); for (const r of db.prepare("select test_files tf from runs where started_at >= ?").all(ff)) for (const f of JSON.parse(r.tf)) ran.add(f.project+" "+f.path);
const cols=db.prepare("pragma table_info(test_files)").all().map(c=>c.name); console.log(cols);
const NEW=["packages/cezar/src/core/session-descendants.ts","packages/cezar/src/runners/antigravity/catalog-home.ts","packages/cezar/src/runners/antigravity/stderr.ts"];
let withNew=0, ranWithNew=0, ranTotal=0; const updated=[];
for (const t of db.prepare("select project, path, closure_paths c, updated_at u from test_files").all()) {
  const has = NEW.some(p=>t.c.includes(JSON.stringify(p)) || t.c.includes(p));
  if (has) withNew++;
  if (ran.has(t.project+" "+t.path)) { ranTotal++; if (has) ranWithNew++; }
}
console.log({testFilesWithANewPathInClosure: withNew, ranAfterFf: ran.size, ranInStore: ranTotal, ranWithNewPath: ranWithNew});
