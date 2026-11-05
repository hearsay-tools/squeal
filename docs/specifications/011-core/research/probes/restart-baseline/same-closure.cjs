// 011-298 probe (throwaway): live worktrees whose closure files hash the same but whose stored key differs.
// Usage: node same-closure.cjs <store copy> [project]
// For each test file, groups the live worktrees' current keys (test_file_keys) by the hashes of the file's stored
// closure paths in each worktree (file_hashes). One closure group with two or more keys means the key moved by
// something outside the closure hashes: the environment hash, the dependency segment, runtime files, or declared inputs.
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const only = process.argv[3] ?? null;
const hashes = new Map();
for (const r of db.prepare("select worktree_id w, path, hash from file_hashes").all()) {
  (hashes.get(r.w) ?? hashes.set(r.w, new Map()).get(r.w)).set(r.path, r.hash);
}
const closure = new Map(db.prepare("select project, path, closure_paths from test_files").all().map((t) => [t.project + "\0" + t.path, JSON.parse(t.closure_paths)]));
const byFile = new Map();
for (const r of db.prepare("select worktree_id w, project, path, key from test_file_keys where key is not null").all()) {
  if (only && r.project !== only) continue;
  const k = r.project + "\0" + r.path; (byFile.get(k) ?? byFile.set(k, []).get(k)).push(r);
}
const S = { files: 0, groupsMulti: 0, groupsSingle: 0, filesWithSplit: 0, pairs: {} };
for (const [k, rows] of byFile) {
  const cl = closure.get(k); if (!cl) continue; S.files++;
  const g = new Map();
  for (const r of rows) {
    const h = hashes.get(r.w); if (!h) continue;
    const vec = cl.map((p) => h.get(p) ?? "-").join(",");
    (g.get(vec) ?? g.set(vec, []).get(vec)).push(r);
  }
  let split = false;
  for (const rs of g.values()) {
    if (rs.length < 2) continue;
    const keys = new Set(rs.map((r) => r.key));
    if (keys.size > 1) { S.groupsMulti++; split = true; const ws = [...new Set(rs.map((r) => r.w.slice(0, 8)))].sort().join(" "); }
    else S.groupsSingle++;
  }
  if (split) S.filesWithSplit++;
}
console.log(JSON.stringify(S));
