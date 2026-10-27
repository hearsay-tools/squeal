// 015-14 Round 3: coverage records stored since a mark, by form (a 015-85
// manifest or a full record) and by the worktree whose run made the result at
// the record's key, read only. A worktree id is the first 16 hex characters of
// the SHA-256 of its root (Round 2, `out/roots.json`); `roots` maps the ids of
// the roots given to their last path part.
// Usage: node records.mjs <.git/squeal dir> <mark, ISO time> [<worktree root>...]
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";

const [dir, markIso, ...roots] = process.argv.slice(2);
const names = new Map(roots.map((r) => [createHash("sha256").update(r).digest("hex").slice(0, 16), r.split("/").at(-1)]));
const open = (name) => {
  const db = new DatabaseSync(`${dir}/${name}`, { readOnly: true });
  db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 5000");
  return db;
};
const code = open("code.sqlite");
const main = open("store.sqlite");
const producers = main.prepare("SELECT DISTINCT worktree_id, run_id FROM results WHERE key = ?");
const groups = {};
for (const r of code.prepare("SELECT result_key, record, recorded_at FROM coverage WHERE recorded_at >= ?").iterate(Date.parse(markIso))) {
  const value = JSON.parse(inflateRawSync(r.record).toString("utf8"));
  const form = Array.isArray(value.parts) ? "manifest" : "full";
  const made = producers.all(r.result_key);
  const worktrees = [...new Set(made.map((m) => m.worktree_id))].sort().join("+") || "no result";
  const g = (groups[`${form} ${worktrees}`] ??= { form, worktrees, name: names.get(worktrees) ?? null, records: 0, bytes: 0, first: null, last: null, runs: new Set() });
  const at = new Date(Number(r.recorded_at)).toISOString();
  g.records++;
  g.bytes += r.record.length;
  if (g.first === null || at < g.first) g.first = at;
  if (g.last === null || at > g.last) g.last = at;
  for (const m of made) g.runs.add(m.run_id);
}
console.log(JSON.stringify(Object.values(groups).map((g) => ({ ...g, runs: g.runs.size })), null, 1));
