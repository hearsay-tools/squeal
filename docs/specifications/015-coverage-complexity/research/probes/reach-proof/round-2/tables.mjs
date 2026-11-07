import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const names = db.prepare("select name from sqlite_master where type = 'table' and name in ('import_edges','import_targets','environment_files','environment_inputs','worktree_environments','test_file_imports','environment_walks')").all().map((r) => r.name);
console.log(process.argv[2], names.map((n) => `${n}=${db.prepare(`select count(*) n from "${n}"`).get().n}`).join(", ") || "no import tables");
console.log("  rewalk markers:", db.prepare("select key, value from meta where key like '%importRewalk%'").all().map((r) => `${r.key}=${r.value}`).join(", ") || "none");
