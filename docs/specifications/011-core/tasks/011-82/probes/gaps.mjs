// 011-82 probe: the quiet before and after each large tier. Read-only.
// Usage: node gaps.mjs <store.sqlite> <tiers.json from tiers.mjs> [out.json]
// Per large tier (13+ files): `before`, seconds from the worktree's last
// revision to the tier's start; `after`, from its start to the next
// revision. Then, for a quiet period Q, which tiers a rule "start a backlog
// tier only Q s after the last revision" would have held back, and what
// they stored and lost.
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [, , storePath, tiersPath, out] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
const tiers = JSON.parse(readFileSync(tiersPath, "utf8")).rows.filter((t) => t.files >= 13);
const runs = new Map(
  db
    .prepare("SELECT id, worktree_id, started_at FROM runs WHERE started_at >= ?")
    .all(Date.now() - 48 * 3600_000)
    .map((r) => [r.id.slice(0, 8), r]),
);
const prev = db.prepare(
  "SELECT max(created_at) t FROM revisions WHERE worktree_id = ? AND created_at <= ?",
);
const next = db.prepare(
  "SELECT min(created_at) t FROM revisions WHERE worktree_id = ? AND created_at > ?",
);
const rows = [];
/** The worktree's previous large tier was cancelled by an edit or a revision: a burst is on. */
const lastByWorktree = new Map();
for (const t of tiers) {
  const run = runs.get(t.id);
  if (!run) continue;
  const p = prev.get(run.worktree_id, run.started_at).t;
  const n = next.get(run.worktree_id, run.started_at).t;
  const last = lastByWorktree.get(run.worktree_id);
  rows.push({
    ...t,
    before: p === null ? null : (run.started_at - p) / 1000,
    after: n === null ? null : (n - run.started_at) / 1000,
    afterCancel: last !== undefined && last.cancelled && last.cause !== "squeal stop",
  });
  lastByWorktree.set(run.worktree_id, t);
}
const pct = (xs, q) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length === 0 ? null : Math.round(s[Math.floor(q * (s.length - 1))]);
};
const describe = (list) => ({
  tiers: list.length,
  files: list.reduce((a, t) => a + t.files, 0),
  stored: list.reduce((a, t) => a + t.storedEnded, 0),
  wallS: Math.round(list.reduce((a, t) => a + t.wallS, 0)),
  beforeP25: pct(list.map((t) => t.before), 0.25),
  beforeP50: pct(list.map((t) => t.before), 0.5),
  beforeP75: pct(list.map((t) => t.before), 0.75),
});
const cancelled = rows.filter((t) => t.cancelled && t.cause !== "squeal stop");
const finished = rows.filter((t) => !t.cancelled);
const quiet = (onlyAfterCancel) => (q) => {
  const held = (t) => t.before !== null && t.before < q && (!onlyAfterCancel || t.afterCancel);
  const hc = cancelled.filter(held);
  const hf = finished.filter(held);
  return {
    quietS: q,
    finishedDelayS: Math.round(hf.reduce((a, t) => a + (q - t.before), 0)),
    cancelledHeld: hc.length,
    cancelledHeldFilesLost: hc.reduce((a, t) => a + t.files - t.storedEnded, 0),
    cancelledHeldStored: hc.reduce((a, t) => a + t.storedEnded, 0),
    cancelledHeldWallS: Math.round(hc.reduce((a, t) => a + t.wallS, 0)),
    finishedHeld: hf.length,
    finishedHeldStored: hf.reduce((a, t) => a + t.storedEnded, 0),
    finishedHeldWallS: Math.round(hf.reduce((a, t) => a + t.wallS, 0)),
  };
};
const qs = [5, 10, 20, 30, 60, 120];
const summary = {
  store: storePath,
  cancelled: describe(cancelled),
  cancelledAfterCancel: describe(cancelled.filter((t) => t.afterCancel)),
  finished: describe(finished),
  finishedAfterCancel: describe(finished.filter((t) => t.afterCancel)),
  always: qs.map(quiet(false)),
  afterCancel: qs.map(quiet(true)),
};
console.log(JSON.stringify(summary, null, 1));
if (out) writeFileSync(out, `${JSON.stringify({ summary, rows }, null, 1)}\n`);
