// Throwaway probe (research 023-01, question 3). How often test runs of different
// worktrees of one repository already overlap in time: a temporary checkout would be
// one more such worktree. Reads a VACUUM INTO copy of a store.
// Usage: node concurrency.mjs <store-copy.sqlite> <days>
import { DatabaseSync } from "node:sqlite";
const [store, days] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const now = db.prepare("select max(started_at) m from runs").get().m;
const since = now - Number(days) * 86400e3;
const runs = db.prepare("select worktree_id w, started_at s, ended_at e from runs where started_at >= ? and ended_at is not null and ended_at > started_at").all(since);
const ev = [];
for (const r of runs) { ev.push([r.s, 1, r.w]); ev.push([r.e, -1, r.w]); }
ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const active = new Map(); // worktree -> open runs
let last = ev[0]?.[0] ?? 0;
const timeAt = new Map(); // distinct worktrees running -> ms
for (const [t, d, w] of ev) {
  const k = active.size;
  timeAt.set(k, (timeAt.get(k) ?? 0) + (t - last));
  last = t;
  const n = (active.get(w) ?? 0) + d;
  if (n <= 0) active.delete(w); else active.set(w, n);
}
let busy = 0, two = 0, max = 0;
for (const [k, ms] of timeAt) { if (k >= 1) busy += ms; if (k >= 2) two += ms; if (ms > 0 && k > max) max = k; }
const worktrees = new Set(runs.map((r) => r.w)).size;
const dist = Object.fromEntries([...timeAt].filter(([k]) => k >= 1).sort((a, b) => a[0] - b[0]).map(([k, ms]) => [k, +(ms / 3600e3).toFixed(2)]));
console.log(JSON.stringify({ store, days: Number(days), runs: runs.length, worktrees, busyHours: +(busy / 3600e3).toFixed(1), shareOfBusyWithTwoOrMore: +(two / busy).toFixed(3), maxDistinctWorktreesAtOnce: max, hoursByDistinctWorktrees: dist }));
