// Row 015-114: which walked files have no stored import edges at their current
// bytes, the files that make a pair read "path not recorded yet".
// Usage: node unrecorded.mjs <store.sqlite> <clone root>
// Reads the worktree's file_hashes as the reader does (bytes by stored hash; the
// stat check is skipped: the clone is unchanged since its daemon hashed it).
import { DatabaseSync } from "node:sqlite";
const [storePath, root] = process.argv.slice(2);
const db = new DatabaseSync(storePath, { readOnly: true });
const wt = db.prepare("select id from worktrees where root = ?").get(root).id;
const hashOf = new Map(db.prepare("select path, hash from file_hashes where worktree_id = ?").all(wt).map((r) => [r.path, r.hash]));
const edge = db.prepare("select static, dynamic from import_edges where path = ? and hash = ?");
const any = db.prepare("select count(*) n from import_edges where path = ?");
const MODULE = /\.(?:[mc]?[jt]s|[jt]sx|py)$/;
const missing = new Map();
const tests = db.prepare("select k.project, k.path, t.closure_paths from test_file_keys k join test_files t on t.project = k.project and t.path = k.path where k.worktree_id = ? and t.updated_by = ?").all(wt, wt);
let incomplete = 0;
for (const t of tests) {
  const seen = new Set([t.path]);
  const todo = [t.path];
  let gap = false;
  while (todo.length) {
    const from = todo.pop();
    const h = hashOf.get(from);
    const row = h === undefined ? undefined : edge.get(from, h);
    if (row === undefined) {
      gap = true;
      const why = h === undefined ? "no hash in this worktree" : any.get(from).n > 0 ? "edges only at other bytes" : "no edges at any bytes";
      const m = missing.get(from) ?? { why, tests: 0 };
      m.tests++;
      missing.set(from, m);
      continue;
    }
    for (const to of [...JSON.parse(row.static), ...JSON.parse(row.dynamic)]) if (!seen.has(to)) (seen.add(to), todo.push(to));
  }
  if (gap) incomplete++;
}
console.log(`${tests.length} own closures, ${incomplete} with a walk gap, ${missing.size} files without edges`);
const byWhy = {};
for (const [p, m] of missing) (byWhy[m.why] ??= []).push([p, m.tests]);
for (const [why, list] of Object.entries(byWhy)) {
  list.sort((a, b) => b[1] - a[1]);
  console.log(`  ${why}: ${list.length} files; modules ${list.filter(([p]) => MODULE.test(p)).length}`);
  for (const [p, n] of list.slice(0, 8)) console.log(`    ${p} (in ${n} walks)`);
}
