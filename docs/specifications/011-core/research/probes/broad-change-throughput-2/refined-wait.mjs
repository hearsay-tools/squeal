// refined-wait.mjs <store.sqlite> <edit ms> <max s>: waits until the revision
// created at or after <edit ms> (less 1 s) is refined: the store's `meta` row
// for the worktree's refined revision (scheduler/refined.ts, row 011-339)
// reaches it. Polls every 200 ms, read-only. Prints: revision, the first poll
// time (epoch ms) that saw it refined ("-" if not within <max s>), the first
// run's start at that revision or later, and the files queued then.
import { DatabaseSync } from "node:sqlite";
const [store, editArg, maxArg] = process.argv.slice(2);
const edit = Number(editArg), end = Date.now() + Number(maxArg) * 1000;
const db = new DatabaseSync(store, { readOnly: true, timeout: 2000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rev = null, refinedAt = null;
while (Date.now() < end) {
  try {
    rev ??= db.prepare("select worktree_id w, max(number) n from revisions where created_at >= ?").get(edit - 1000);
    if (rev?.n != null) {
      const row = db.prepare("select value from meta where key like ? and key like ?").get("%refined%", `%${rev.w}`);
      if (row && Number(row.value) >= rev.n) { refinedAt = Date.now(); break; }
    } else rev = null;
  } catch { /* a busy store: poll again */ }
  await sleep(200);
}
await sleep(3000);
const run = rev?.n == null ? null : db.prepare("select min(started_at) s from runs where revision >= ? and started_at >= ?").get(rev.n, edit).s;
const q = db.prepare("select count(*) n from test_file_keys where pending is not null").get().n;
console.log(rev?.n ?? "-", refinedAt ?? "-", run ?? "-", q);
