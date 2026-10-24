// Stored complexity transitions in the window, per worktree and kind. Opens each code store read only.
// Usage: node transitions.mjs <code.sqlite> <from ISO> <to ISO> <roots.json>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [path, from, to] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: true });
const cols = db.prepare("PRAGMA table_info(transitions)").all().map((c) => c.name);
const wt = JSON.parse(readFileSync(process.argv[5], "utf8")); // id -> root, sha256(root) first 16 hex
const timeCol = "at";
const rows = db.prepare(`SELECT * FROM transitions WHERE ${timeCol} >= ? AND ${timeCol} < ?`).all(Date.parse(from), Date.parse(to));
const out = {};
for (const r of rows) {
  const root = wt[r.worktree_id] ?? `unknown-${r.worktree_id}`;
  const key = root.split("/").pop().slice(0, 8);
  const kind = `${r.kind}:${r.from_outcome}-to-${r.to_outcome}`;
  (out[key] ??= {})[kind] = (out[key][kind] ?? 0) + 1;
}
console.log(JSON.stringify(out));
