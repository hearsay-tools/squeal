// Row 015-114 round 2: edits (watch revisions with no HEAD move, readEdits' rule) in two
// store copies of one repository, and what the later copy lost with removed worktrees.
// Usage: node edits-diff.mjs <older store> <newer store> <path>...
import { DatabaseSync } from "node:sqlite";
const SQL = `SELECT worktree_id w, created_at at, changes FROM (
  SELECT worktree_id, created_at, changes, trigger, head, lag(head) OVER w AS hb, lag(number) OVER w AS nb
  FROM revisions WINDOW w AS (PARTITION BY worktree_id ORDER BY number))
  WHERE trigger = 'watch' AND nb IS NOT NULL AND head IS hb`;
const [older, newer, ...paths] = process.argv.slice(2);
const read = (f) => {
  const db = new DatabaseSync(f, { readOnly: true });
  const edits = db.prepare(SQL).all().map((r) => ({ w: r.w, at: r.at, paths: JSON.parse(r.changes).map((c) => c.path) }));
  const worktrees = new Set(db.prepare("select id from worktrees").all().map((r) => r.id));
  return { edits, worktrees };
};
const a = read(older), b = read(newer);
const lastOld = Math.max(...a.edits.map((e) => e.at));
const lost = a.edits.filter((e) => !b.worktrees.has(e.w));
const keptOld = b.edits.filter((e) => e.at <= lastOld).length;
console.log(`older: ${a.edits.length} edits in ${new Set(a.edits.map((e) => e.w)).size} worktrees; newer: ${b.edits.length} edits, ${keptOld} of them up to the older copy's last edit`);
console.log(`edits of the older copy whose worktree is gone in the newer: ${lost.length} (${new Set(lost.map((e) => e.w)).size} worktrees)`);
for (const p of paths) {
  const n = (s) => s.edits.filter((e) => e.paths.includes(p)).length;
  console.log(`  ${p}: older ${n(a)}, newer ${n(b)}, lost with removed worktrees ${lost.filter((e) => e.paths.includes(p)).length}`);
}
