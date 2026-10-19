// THROWAWAY probe (011-core/research/catch-up.md). Every retained revision of cezar's store copy:
// trigger, HEAD move, changed paths, and how many test files of the worktree's projects the
// current closures (test_files.closure_paths) say each revision re-keyed. Read-only.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync(process.argv[2] ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
// cezar's slow files (squeal.config.json `slow.include`: packages/web/e2e/*.e2e.ts) never take the edit route.
const SLOW = /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/;
const allTests = db.prepare("select project, path, closure_paths from test_files").all()
  .map((t) => ({ id: `${t.project}:${t.path}`, path: t.path, slow: SLOW.test(t.path), closure: new Set(JSON.parse(t.closure_paths)) }));
const testFiles = allTests.filter((t) => !t.slow);
const isTest = new Set(allTests.map((t) => t.path));
const wts = new Map(db.prepare("select id, root, is_main from worktrees").all().map((w) => [w.id, w]));
const revs = db.prepare("select worktree_id, number, created_at, head, dirty, trigger, changes from revisions order by worktree_id, number").all();
const out = [];
let prev = null;
for (const r of revs) {
  const changes = JSON.parse(r.changes);
  const paths = new Set(changes.map((c) => c.path));
  const rekeyed = testFiles.filter((t) => [...paths].some((p) => t.closure.has(p) || p === t.path)).length;
  const headMoved = prev !== null && prev.worktree_id === r.worktree_id && prev.head !== r.head;
  const gap = prev !== null && prev.worktree_id === r.worktree_id ? r.created_at - prev.created_at : null;
  out.push({
    wt: r.worktree_id.slice(0, 8), main: wts.get(r.worktree_id)?.is_main ?? null, n: r.number,
    at: new Date(r.created_at).toISOString(), trigger: r.trigger, head: r.head?.slice(0, 8) ?? null,
    headMoved, gapS: gap === null ? null : Math.round(gap / 1000), dirty: r.dirty,
    changed: paths.size, testsEdited: [...paths].filter((p) => isTest.has(p)).length,
    added: changes.filter((c) => c.oldHash === null).length, deleted: changes.filter((c) => c.newHash === null).length,
    rekeyed, rekeyedSlow: allTests.filter((t) => t.slow && [...paths].some((p) => t.closure.has(p) || p === t.path)).length,
  });
  prev = r;
}
writeFileSync(process.argv[3] ?? "results/revisions.json", JSON.stringify(out, null, 1));
console.log(`${out.length} revisions, ${new Set(out.map((o) => o.wt)).size} worktrees, ${testFiles.length} test files`);
