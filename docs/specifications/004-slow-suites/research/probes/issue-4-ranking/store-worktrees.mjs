// Throwaway, read only: cezarion store query for research/issue-4-ranking.md. Usage: node <this> <path to store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("select id, root, registered_at from worktrees order by registered_at").all();
console.log("worktree rows:", rows.length);
for (const r of rows.filter((r) => /markdown|1076|preview/i.test(r.root))) console.log(" match", r.id, r.root);
const day = rows.filter((r) => r.registered_at >= Date.parse("2026-10-15T00:00:00Z") && r.registered_at < Date.parse("2026-10-16T00:00:00Z"));
console.log("registered on 2026-10-15:", day.length);
const revWts = db.prepare("select count(distinct worktree_id) n from revisions").get();
console.log("distinct worktrees with revisions:", revWts.n);
const mk = db.prepare("select count(*) n from revisions where changes like '%task-thread/markdown.tsx%'").get();
console.log("all revisions ever naming markdown.tsx:", mk.n);
