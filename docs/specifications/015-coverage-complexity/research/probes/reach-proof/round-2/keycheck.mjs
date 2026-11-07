// Row 015-114 round 2: for each saved key list, how many keys have a stored result,
// and how many closures the scratch worktree wrote itself.
// Usage: node keycheck.mjs <store.sqlite> <clone root> <keys file>...
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [storePath, root, ...files] = process.argv.slice(2);
const db = new DatabaseSync(storePath, { readOnly: true });
const wt = db.prepare("select id from worktrees where root = ?").get(root).id;
const has = db.prepare("select 1 from results where key = ? limit 1");
for (const f of files) {
  const keys = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => l.slice(l.lastIndexOf("|") + 1));
  const withResult = keys.filter((k) => k !== "null" && has.get(k)).length;
  console.log(f.split("/").pop(), `${keys.length} keys, ${withResult} with a stored result`);
}
console.log("closures written by this worktree:", db.prepare("select count(*) n from test_files where updated_by = ?").get(wt).n);
