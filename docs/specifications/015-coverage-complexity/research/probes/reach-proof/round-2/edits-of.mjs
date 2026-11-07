// Row 015-114 round 2: the watch revisions that name a path, with HEAD moves.
// Usage: node edits-of.mjs <store.sqlite> <path>...
import { DatabaseSync } from "node:sqlite";
const [storePath, ...paths] = process.argv.slice(2);
const db = new DatabaseSync(storePath, { readOnly: true });
const revs = db.prepare("select worktree_id w, number n, head, trigger, changes, created_at at from revisions order by worktree_id, number").all();
const prevHead = new Map();
const byPath = Object.fromEntries(paths.map((p) => [p, []]));
for (const r of revs) {
  const before = prevHead.get(r.w);
  prevHead.set(r.w, r.head);
  if (r.trigger !== "watch") continue;
  let ch; try { ch = JSON.parse(r.changes); } catch { continue; }
  const names = (Array.isArray(ch) ? ch : []).map((c) => (typeof c === "string" ? c : c.path));
  for (const p of paths) if (names.includes(p)) byPath[p].push({ at: new Date(r.at).toISOString().slice(0, 16), headMoved: before !== undefined && before !== r.head, size: names.length });
}
for (const [p, list] of Object.entries(byPath)) console.log(p, list.length, "watch revisions;", list.filter((x) => !x.headMoved).length, "without a HEAD move; sizes", list.map((x) => x.size).join(","));
