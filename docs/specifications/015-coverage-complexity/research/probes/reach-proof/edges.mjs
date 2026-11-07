import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const has = db.prepare("select name from sqlite_master where name in ('import_edges','environment_files','worktree_environments')").all();
console.log("tables", has.map((r) => r.name).join(","));
if (has.length) {
  console.log("import_edges", db.prepare("select count(*) n from import_edges").get().n);
  console.log("environment_files", db.prepare("select count(*) n from environment_files").get().n);
  console.log("worktree_environments", db.prepare("select * from worktree_environments").all().length);
}
const wt = db.prepare("select id, root from worktrees where root like '/tmp/r114/%'").all();
console.log(wt);
for (const w of wt) console.log("own closures", db.prepare("select count(*) n from test_files where updated_by = ?").get(w.id).n, "keys", db.prepare("select count(*) n from test_file_keys where worktree_id = ?").get(w.id).n);
