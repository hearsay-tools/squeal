// Throwaway: slow-tier durations from a COPY of a Squeal store (opened read-only).
// Usage: node store-durations.mjs <copy.sqlite> <slow-glob-regex> [gapSeconds=30]
import { DatabaseSync } from "node:sqlite";

const [file, pattern, gapArg] = process.argv.slice(2);
const slow = new RegExp(pattern);
const gapMs = Number(gapArg ?? 30) * 1000;
const db = new DatabaseSync(file, { readOnly: true });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const sum = (rows) => {
  const v = rows.map((r) => r / 1000);
  return { n: v.length, median: q(v, 0.5)?.toFixed(1), p90: q(v, 0.9)?.toFixed(1), max: v.length ? Math.max(...v).toFixed(1) : null,
    over120: v.filter((x) => x > 120).length, over600: v.filter((x) => x > 600).length };
};

const runs = db.prepare("SELECT id, worktree_id, test_files, started_at, ended_at, end_state, checkpoint_id FROM runs WHERE ended_at IS NOT NULL ORDER BY worktree_id, started_at").all();
const slowRuns = runs.filter((r) => {
  const files = JSON.parse(r.test_files).map((f) => (typeof f === "string" ? f : f.path));
  r.files = files;
  return files.length > 0 && files.every((p) => slow.test(p));
});
const span = (a, b) => [Math.min(...slowRuns.map((r) => r.started_at)), Math.max(...slowRuns.map((r) => r.ended_at))];
const [from, to] = slowRuns.length ? span() : [0, 0];
console.log("runs", runs.length, "slow runs", slowRuns.length, "from", new Date(from).toISOString(), "to", new Date(to).toISOString());
console.log("end states", JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(slowRuns, (r) => r.end_state ?? "null")).map(([k, v]) => [k, v.length]))));
console.log("per slow run (wall, s)", JSON.stringify(sum(slowRuns.map((r) => r.ended_at - r.started_at))));
console.log("files per slow run", JSON.stringify(sum(slowRuns.map((r) => r.files.length * 1000))));

// Passes: consecutive slow runs of one worktree, each starting within gapMs of the previous end.
const passes = [];
for (const r of slowRuns) {
  const last = passes.at(-1);
  if (last && last.wt === r.worktree_id && r.started_at - last.end <= gapMs) {
    last.end = Math.max(last.end, r.ended_at); last.runs++; for (const f of r.files) last.files.add(f);
  } else passes.push({ wt: r.worktree_id, start: r.started_at, end: r.ended_at, runs: 1, files: new Set(r.files) });
}
console.log(`passes (gap <= ${gapMs / 1000} s): wall`, JSON.stringify(sum(passes.map((p) => p.end - p.start))));
console.log("passes: distinct files", JSON.stringify(sum(passes.map((p) => p.files.size * 1000))));
const big = passes.filter((p) => p.files.size >= 45);
console.log("passes with >= 45 files: wall", JSON.stringify(sum(big.map((p) => p.end - p.start))));

// Per file: summed check durations per (run, file) from results.
const rows = db.prepare("SELECT r.run_id AS run, c.test_path AS path, SUM(r.duration_ms) AS ms FROM results r JOIN checks c ON c.id = r.check_id GROUP BY r.run_id, c.test_path").all();
const perFile = rows.filter((r) => slow.test(r.path)).map((r) => r.ms);
console.log("per slow file and run, summed check time (s)", JSON.stringify(sum(perFile)));
