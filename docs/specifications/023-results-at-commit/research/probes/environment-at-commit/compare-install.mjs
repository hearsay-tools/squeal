// Throwaway (environment-at-commit): the environment hash per project a daemon
// computed in a scratch checkout after a frozen install, against the hash a
// live daemon keys a live worktree at the same commit with, read from a store
// copy (copy.mjs). Where they differ, names the differing descriptor parts.
// Usage: node compare-install.mjs <scratch checkout store> <scratch live store> <live worktree root>
import { DatabaseSync } from "node:sqlite";
const [mine, live, root] = process.argv.slice(2);
const read = (path, sql, ...a) => new DatabaseSync(path, { readOnly: true }).prepare(sql).all(...a);
const q = "select w.project, w.hash, e.descriptor from worktree_environment_hashes w join environments e on e.hash = w.hash";
const a = new Map(read(mine, q).map((r) => [r.project, r]));
const lw = read(live, "select id from worktrees where root = ?", root)[0].id;
const b = new Map(read(live, `${q} where w.worktree_id = ?`, lw).map((r) => [r.project, r]));
const out = [];
for (const [p, x] of a) {
  const y = b.get(p);
  if (!y) { out.push({ project: p, live: null }); continue; }
  const dx = JSON.parse(x.descriptor), dy = JSON.parse(y.descriptor);
  const parts = [];
  for (const k of new Set([...Object.keys(dx), ...Object.keys(dy)])) {
    if (k === "config") { for (const f of new Set([...Object.keys(dx.config), ...Object.keys(dy.config)])) if (dx.config[f] !== dy.config[f]) parts.push(`config.${f}`); }
    else if (k === "files") { const m = new Map(dy.files); for (const [f, h] of dx.files) if (m.get(f) !== h) parts.push(`file:${f}`); if (dx.files.length !== dy.files.length) parts.push("files: count"); }
    else if (JSON.stringify(dx[k]) !== JSON.stringify(dy[k])) parts.push(k);
  }
  out.push({ project: p, scratch: x.hash.slice(0, 12), live: y.hash.slice(0, 12), equal: x.hash === y.hash, differingParts: parts });
}
console.log(JSON.stringify(out, null, 1));
