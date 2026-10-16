// Throwaway, read only: cezarion store query for research/issue-4-ranking.md. Usage: node <this> <path to store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const w = "b7555ac0d0f19f40";
const revs = db.prepare("select number, created_at, head, trigger, length(changes) n, substr(changes,1,300) c from revisions where worktree_id = ? and number between 80 and 90 order by number").all(w);
for (const r of revs) console.log("r" + r.number, new Date(r.created_at).toISOString(), r.head?.slice(0, 9), r.trigger, r.n, r.c.replace(/\s+/g, " ").slice(0, 200));
const runs = db.prepare("select revision, test_files, started_at, end_state from runs where worktree_id = ? and revision >= 84 and test_files like '%packages/web/e2e/%' order by started_at").all(w);
console.log("web e2e runs at r>=84:", runs.length);
for (const r of runs.slice(0, 80)) console.log(" ", new Date(r.started_at).toISOString(), "r" + r.revision, r.end_state, JSON.parse(r.test_files).map((f) => f.path.replace("packages/web/e2e/", "")).join(" "));
// Worktrees seen in the incident window.
const from = Date.parse("2026-10-15T17:00:00Z"), to = Date.parse("2026-10-15T22:00:00Z");
for (const x of db.prepare("select worktree_id, count(*) n, min(number) a, max(number) b from revisions where created_at between ? and ? group by worktree_id").all(from, to)) {
  const root = db.prepare("select root from worktrees where id = ?").get(x.worktree_id)?.root ?? "(worktree row gone)";
  console.log("window worktree", x.worktree_id, root, "revisions", x.n, x.a, "-", x.b);
}
