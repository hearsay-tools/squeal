// Throwaway, read only: cezarion store query for research/issue-4-ranking.md. Usage: node <this> <path to store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const from = Date.parse("2026-10-15T12:00:00Z"), to = Date.parse("2026-10-16T00:00:00Z");
// Revisions whose changes name markdown.tsx in that window.
const revs = db.prepare("select worktree_id, number, created_at, trigger from revisions where created_at between ? and ? and changes like '%task-thread/markdown.tsx%' order by created_at").all(from, to);
console.log("revisions touching markdown.tsx:", revs.length);
for (const r of revs.slice(0, 20)) console.log(" ", r.worktree_id, r.number, new Date(r.created_at).toISOString(), r.trigger);
const wts = [...new Set(revs.map((r) => r.worktree_id))];
for (const w of wts) {
  const root = db.prepare("select root from worktrees where id = ?").get(w)?.root;
  const runs = db.prepare("select revision, test_files, started_at, ended_at, end_state from runs where worktree_id = ? and started_at between ? and ? and test_files like '%packages/web/e2e/%' order by started_at").all(w, from, to);
  console.log("\nworktree", w, root, "web e2e runs:", runs.length);
  for (const r of runs.slice(0, 100)) {
    const files = JSON.parse(r.test_files).map((f) => (f.path ?? f).toString().replace("packages/web/e2e/", ""));
    console.log(" ", new Date(r.started_at).toISOString(), "r" + r.revision, r.end_state, files.join(" "));
  }
}
