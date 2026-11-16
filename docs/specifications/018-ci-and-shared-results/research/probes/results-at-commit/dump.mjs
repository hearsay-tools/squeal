// Throwaway (results-at-commit). One read-only pass over a Squeal store:
// results grouped by (commit label, project, test path, key, dirty), with
// the origin of the rows (a worktree, an import, a gate) and the newest
// record time. Writes JSON lines to <out>. Opens the live store read-only.
// Usage: node dump.mjs <store.sqlite> <out.jsonl>
import { createWriteStream } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [store, out] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const hasImports = db.prepare("select 1 from sqlite_master where name = 'imports'").get() !== undefined;
const imports = new Set(hasImports ? db.prepare("select id from imports").all().map((r) => r.id) : []);
const worktrees = new Set(db.prepare("select id from worktrees").all().map((r) => r.id));
const w = createWriteStream(out);
let n = 0;
const sql = `select r.commit_sha c, ch.project p, ch.test_path t, r.key k, r.dirty d,
  r.worktree_id wt, count(*) rows, max(r.recorded_at) at, min(r.recorded_at) at0
  from results r join checks ch on ch.id = r.check_id
  group by r.commit_sha, ch.project, ch.test_path, r.key, r.dirty, r.worktree_id`;
for (const row of db.prepare(sql).iterate()) {
  const origin = row.wt.startsWith("import:") || imports.has(row.wt) ? "import" : worktrees.has(row.wt) ? "live" : "gone";
  w.write(`${JSON.stringify({ ...row, origin })}\n`);
  n++;
}
w.end();
console.log(JSON.stringify({ store, groups: n, imports: imports.size, worktrees: worktrees.size }));
