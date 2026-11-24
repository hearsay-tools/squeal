// Probe 023-81: one snapshot of a worktree's store and its listed folders, as JSON on stdout.
// usage: node snap.cjs <store.sqlite> <root> [label]
const { DatabaseSync } = require("node:sqlite");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const [store, root, label = ""] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const meta = (k) => db.prepare("select value from meta where key = ?").get(k)?.value;
const observed = {};
for (const r of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
  if (r.key.startsWith("observedDirect")) continue;
  for (const [t, ps] of Object.entries(JSON.parse(r.value))) {
    const l = ps.filter((p) => p.endsWith("/"));
    if (l.length) observed[t] = l;
  }
}
const dirs = [...new Set(Object.values(observed).flat())].sort();
const names = {};
for (const d of dirs) {
  try { names[d] = readdirSync(join(root, d === "./" ? "" : d)).sort(); } catch { names[d] = null; }
}
const keys = {};
for (const r of db.prepare("select w.root, k.path, k.key, k.revision, k.pending from test_file_keys k join worktrees w on w.id = k.worktree_id").all()) {
  if (r.root !== root) continue;
  keys[r.path] = { key: r.key?.slice(0, 12) ?? null, rev: r.revision, pending: r.pending };
}
const runs = db.prepare("select r.id, r.revision, r.test_files, r.started_at, r.ended_at, r.end_state from runs r join worktrees w on w.id = r.worktree_id where w.root = ? order by started_at").all(root)
  .map((r) => ({ ...r, test_files: JSON.parse(r.test_files).map((f) => f.path ?? f) }));
process.stdout.write(JSON.stringify({ label, at: Date.now(), observed, names, keys, runs }) + "\n");
