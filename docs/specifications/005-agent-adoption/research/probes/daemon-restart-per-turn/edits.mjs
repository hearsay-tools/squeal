// Throwaway probe for row 005-99 (see README.md). Read-only: opens the store with
// `immutable=1` (no lock, no WAL read: the last minutes before the read are missing).
// For each watch or interval revision since SINCE: the daemon's state when it was recorded
// (starting: after the process's first log line and before its "serving" line; or serving,
// with its age), and the time to the first run in the worktree at that revision or later.
// Usage: node edits.mjs <repo-dir> > edits.jsonl
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { daemons, loadAt } from "./lib.mjs";

const SINCE = Date.parse(process.env.SINCE ?? "2026-11-14T00:00:00Z");
const repo = process.argv[2];
const { byLog, loads } = daemons(join(repo, ".git/squeal/logs"));
const db = new DatabaseSync(new URL(`file://${join(repo, ".git/squeal/store.sqlite")}?immutable=1`), {
  readOnly: true,
});
const revisions = db
  .prepare(
    `SELECT v.worktree_id w, v.number n, v.created_at t, v.trigger, w.is_main main
       FROM revisions v JOIN worktrees w ON w.id = v.worktree_id
      WHERE v.created_at > ? AND v.trigger IN ('watch', 'interval')`,
  )
  .all(SINCE);
const firstRun = db.prepare(
  `SELECT min(started_at) s, min(ended_at) e FROM runs
    WHERE worktree_id = ? AND revision >= ? AND started_at >= ? AND started_at < ?`,
);
for (const r of revisions) {
  const list = byLog.get(r.w) ?? [];
  const p = list.find((d) => d.first <= r.t && (d.stop ?? d.last) >= r.t && !d.gaveUp && !d.other);
  let state = "unknown";
  if (p !== undefined) {
    if (p.serving === null || r.t < p.serving) state = "starting";
    else state = r.t - p.serving < 300_000 ? "serving<5m" : "serving>=5m";
  }
  const run = firstRun.get(r.w, r.n, r.t, r.t + 1_800_000);
  process.stdout.write(
    `${JSON.stringify({
      w: r.w,
      n: r.n,
      main: r.main,
      trigger: r.trigger,
      state,
      toServing: p?.serving != null && r.t < p.serving ? p.serving - r.t : null,
      toRun: run.s === null ? null : run.s - r.t,
      load: loadAt(loads, r.t),
    })}\n`,
  );
}
