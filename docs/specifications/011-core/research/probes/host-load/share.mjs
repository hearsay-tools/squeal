// Live worktrees' key sharing in one project's store, read-only.
// Usage: node share.mjs <git-common-dir>/squeal/store.sqlite
// A worktree is live when its daemon's heartbeat is under 10 minutes old.
// For each live worktree with at least 100 keyed test files: the share of its keys
// that another live worktree also holds. Prints JSON with the median of those shares.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const live = db.prepare("SELECT id, root FROM worktrees WHERE daemon_heartbeat_at > ?").all(Date.now() - 10 * 60000);
const ids = new Set(live.map((w) => w.id));
const name = Object.fromEntries(live.map((w) => [w.id, w.root.split("/").pop().slice(0, 8)]));
const keys = db.prepare("SELECT worktree_id w, key FROM test_file_keys").all().filter((k) => ids.has(k.w) && k.key);
const holders = new Map();
for (const k of keys) holders.set(k.key, (holders.get(k.key) ?? new Set()).add(k.w));
const per = {};
for (const k of keys) {
  const e = (per[name[k.w]] ??= { files: 0, shared: 0 });
  e.files++;
  if (holders.get(k.key).size > 1) e.shared++;
}
const counted = Object.values(per).filter((e) => e.files >= 100).map((e) => e.shared / e.files).sort((a, b) => a - b);
const median = counted.length ? (counted[(counted.length - 1) >> 1] + counted[counted.length >> 1]) / 2 : null;
console.log(JSON.stringify({
  liveWorktrees: live.length,
  holdersPerKey: +(keys.length / Math.max(1, holders.size)).toFixed(2),
  worktreesCounted: counted.length,
  medianSharedShare: median === null ? null : +(100 * median).toFixed(0),
  perWorktree: Object.fromEntries(Object.entries(per).map(([w, e]) => [w, `${e.shared}/${e.files} = ${Math.round((100 * e.shared) / e.files)}%`])),
}, null, 1));
