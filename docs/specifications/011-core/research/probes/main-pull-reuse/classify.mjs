// Throwaway, read-only. For each test file of the Cezar main worktree at revision 159 with no
// reusable result at the pull, compare its closure and environment files between the final
// commit and every commit another worktree recorded a result for it at, before the pull.
// Usage: node classify.mjs <repo> <main worktree id> <pull time ISO> <final commit>
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
const [repo, main, at, final] = process.argv.slice(2);
const T0 = Date.parse(at);
const db = new DatabaseSync(`${repo}/.git/squeal/store.sqlite`, { readOnly: true });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const diffs = new Map();
const changed = (c) => {
  if (!diffs.has(c)) {
    try { diffs.set(c, new Set(git('diff', '--name-only', c, final).split('\n').filter(Boolean))); }
    catch { diffs.set(c, null); }
  }
  return diffs.get(c);
};
const ENV = /^(vitest\.config\.ts|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|packages\/[^/]+\/(package\.json|vitest\.config\.ts|vitest\.setup\.ts|tsconfig\.json))$/;
const keys = db.prepare(`select project, path, key from test_file_keys where worktree_id=?`).all(main);
const closureOf = db.prepare(`select closure_paths from test_files where project=? and path=?`);
const cands = db.prepare(`select r.worktree_id w, r.commit_sha c, max(r.dirty) d, r.key k, min(r.recorded_at) t
  from checks ch join results r on r.check_id=ch.id where ch.project=? and ch.test_path=? and r.recorded_at < ?
  group by r.worktree_id, r.commit_sha, r.key`);
const hit = db.prepare(`select 1 from checks ch join results r on r.check_id=ch.id and r.key=?
  where ch.project=? and ch.test_path=? and r.recorded_at < ? limit 1`);
const out = [];
for (const { project, path, key } of keys) {
  if (hit.get(key, project, path, T0)) { out.push({ project, path, cls: 'inherited' }); continue; }
  const closure = JSON.parse(closureOf.get(project, path)?.closure_paths ?? '[]');
  const cs = cands.all(project, path, T0);
  if (cs.length === 0) { out.push({ project, path, cls: 'never-run-anywhere' }); continue; }
  let best = null;
  for (const c of cs) {
    if (!c.c) continue;
    const d = changed(c.c);
    if (!d) continue;
    const cl = closure.filter((p) => d.has(p));
    const env = [...d].filter((p) => ENV.test(p));
    const score = cl.length * 1000 + env.length;
    if (!best || score < best.score) best = { score, cl, env, c: c.c, w: c.w, d: c.d, t: c.t };
  }
  if (!best) { out.push({ project, path, cls: 'no-commit' }); continue; }
  const cls = best.cl.length ? 'closure-differs' : best.env.length ? 'env-differs-only' : 'same-content';
  out.push({ project, path, cls, closure: closure.length, best });
}
console.log(JSON.stringify(out));
