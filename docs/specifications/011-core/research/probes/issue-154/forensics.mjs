// Throwaway forensic probe for row 011-303 (issue #154). Read-only: it opens
// each store with `readOnly: true`, runs short SELECTs and writes nothing.
// It starts no daemon, runs no test and makes no CPU load beyond the reads.
//
//   node forensics.mjs <state-dir> <worktree-root> <neighbour-id> <from-iso> <to-iso>
//
// <state-dir> is `<git common dir>/squeal` (store.sqlite, lint.sqlite,
// code.sqlite). <worktree-root> may be gone: its id is sha256(realpath)[0:16],
// as `worktreeIdOfRealPath` in src/core/fs/git-layout.ts (0.1.407).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [stateDir, root, neighbour, fromIso, toIso] = process.argv.slice(2);
if (stateDir === undefined || root === undefined || toIso === undefined) {
  console.error("usage: node forensics.mjs <state-dir> <worktree-root> <neighbour-id> <from-iso> <to-iso>");
  process.exit(2);
}
const from = Date.parse(fromIso);
const to = Date.parse(toIso);
const id = createHash("sha256").update(root).digest("hex").slice(0, 16);
const open = (name) => new DatabaseSync(join(stateDir, name), { readOnly: true });
const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const out = (label, value) => console.log(JSON.stringify({ label, ...value }));

out("worktree", { root, id });

const store = open("store.sqlite");
out("worktree-row", { row: store.prepare("select * from worktrees where id = ?").get(id) ?? null });
for (const c of store
  .prepare("select id, revision, kind, started_at, completed_at, end_state from checkpoints where worktree_id = ? order by started_at")
  .all(id)) {
  out("checkpoint", { ...c, started_at: iso(c.started_at), completed_at: iso(c.completed_at) });
}
for (const r of store
  .prepare("select id, revision, started_at, ended_at, end_state, test_files from runs where worktree_id = ? order by started_at")
  .all(id)) {
  const files = JSON.parse(r.test_files).map((f) => `${f.project}:${f.path}`);
  out("run", { id: r.id, revision: r.revision, started: iso(r.started_at), ended: iso(r.ended_at), end: r.end_state, files });
}
{
  const raw = store.prepare("select value from meta where key = ?").get(`notes.${neighbour}`);
  for (const n of raw ? JSON.parse(raw.value) : []) out("neighbour-note", { at: iso(n.at), text: n.text });
  for (const r of store
    .prepare("select id, started_at, ended_at, test_files from runs where worktree_id = ? order by started_at desc limit 6")
    .all(neighbour)) {
    out("neighbour-run", { id: r.id, started: iso(r.started_at), ended: iso(r.ended_at), files: r.test_files });
  }
}
store.close();

const lint = open("lint.sqlite");
for (const row of lint.prepare("select key, value from meta where key like ?").all(`%${id}%`)) {
  out("lint-meta", { key: row.key, value: JSON.parse(row.value) });
}
const states = lint
  .prepare("select outcome, judged_revision, count(*) n from states where worktree_id = ? group by 1, 2")
  .all(id);
out("lint-states", { states });
// Every result linted for this worktree's checks in the window, as bursts split by gaps
// over 3 s. Results are shared by key across worktrees: check that the window holds no
// other daemon's lint work (the incident's neighbour linted nothing then).
const times = lint
  .prepare(
    `select r.check_id, r.linted_at from results r
     where r.check_id in (select check_id from states where worktree_id = ?)
       and r.linted_at between ? and ?
     order by r.linted_at`,
  )
  .all(id, from, to);
const perCheck = new Map();
let burst = null;
const bursts = [];
for (const { check_id, linted_at } of times) {
  perCheck.set(check_id, (perCheck.get(check_id) ?? 0) + 1);
  if (burst === null || linted_at - burst.last > 3000) {
    burst = { first: linted_at, last: linted_at, n: 0 };
    bursts.push(burst);
  }
  burst.last = linted_at;
  burst.n++;
}
for (const b of bursts) out("lint-burst", { first: iso(b.first), last: iso(b.last), results: b.n });
const lintedTimes = new Map();
for (const n of perCheck.values()) lintedTimes.set(n, (lintedTimes.get(n) ?? 0) + 1);
out("checks-by-times-linted", { histogram: Object.fromEntries([...lintedTimes].sort()) });
lint.close();
