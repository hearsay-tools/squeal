// 011-148 probe (throwaway): checkpoint work (baseline and run --all) by what else would have run it, and by daemon start.
// Usage: node ck.mjs <store copy> <fate.jsonl>
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const [, , storePath, fatePath] = process.argv;
const db = new DatabaseSync(storePath, { readOnly: true });
const fate = readFileSync(fatePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const closures = new Map();
for (const t of db.prepare("SELECT project, path, closure_paths FROM test_files").all()) closures.set(t.project + "\0" + t.path, new Set(JSON.parse(t.closure_paths)));
const revs = new Map();
for (const r of db.prepare("SELECT worktree_id, number, created_at, trigger, changes FROM revisions ORDER BY worktree_id, number").all()) {
  r.paths = JSON.parse(r.changes).map((c) => c.path);
  (revs.get(r.worktree_id) ?? revs.set(r.worktree_id, []).get(r.worktree_id)).push(r);
}
const cks = new Map(db.prepare("SELECT * FROM checkpoints").all().map((c) => [c.id, c]));
const runs = new Map(db.prepare("SELECT id, checkpoint_id FROM runs").all().map((r) => [r.id, r]));
const touches = (r, k) => { const p = k.split("\0")[1]; const c = closures.get(k); return r.paths.some((x) => x === p || c?.has(x)); };
const t = {}; const add = (k, s, stored) => { t[k] ??= [0, 0, 0]; t[k][0] += s; t[k][1]++; if (!stored) t[k][2] += s; };
for (const f of fate.filter((f) => f.ck)) {
  const kind = f.ck;
  const list = revs.get(f.w);
  if (!list) { add(`${kind}: worktree removed, not determined`, f.secs, f.stored); continue; }
  const starts = list.filter((r) => r.trigger === "start" && r.number <= f.rev);
  const lastStart = starts.at(-1);
  const watch = list.filter((r) => r.trigger === "watch" && r.number <= f.rev && (!lastStart || r.number > lastStart.number));
  const byEdit = watch.filter((r) => touches(r, f.file));
  if (byEdit.length) { add(`${kind}: re-keyed by a watch revision since the daemon's start (catch-up or edit work anyway)`, f.secs, f.stored); continue; }
  if (kind === "run-all") {
    // the worktree's baseline still open when the run --all started: its files would have run as the baseline
    const c = cks.get(runs.get(f.run)?.checkpoint_id);
    const open = [...cks.values()].some((b) => b.worktree_id === f.w && b.kind === "baseline" && b.started_at <= (c?.started_at ?? f.start) && (b.completed_at === null || b.completed_at > (c?.started_at ?? f.start)) && b.end_state !== "abandoned");
    add(`run-all: ${open ? "the worktree's baseline was still open (would run as baseline)" : "only because of run --all"}`, f.secs, f.stored);
    continue;
  }
  const first = starts.length <= 1;
  const changed = lastStart ? lastStart.paths.length : 0;
  add(`baseline: ${first ? "the worktree's first daemon start" : "a later daemon start"}, ${changed ? "paths changed while no daemon ran" : "no path changed while no daemon ran"}`, f.secs, f.stored);
}
const total = Object.values(t).reduce((a, v) => a + v[0], 0);
for (const [k, [s, n, ns]] of Object.entries(t).sort((a, b) => b[1][0] - a[1][0])) console.log(`${Math.round(s)} s (${(100 * s / total).toFixed(1)}%), ${n} file runs, ${Math.round(100 * ns / s)}% stored nothing: ${k}`);
