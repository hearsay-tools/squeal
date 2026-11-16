// Throwaway probe (research 023-01, question 6). Per test file at commit X: the summed test
// durations of its newest stored run, as the gate's estimate reads stored durations. Then the
// time to run a share of those files at a given width: max(longest file, sum / width).
// Usage: node durations.mjs <store-copy.sqlite> <checkout-at-X> <excluded project,...>
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const [store, wt, excl = ""] = process.argv.slice(2);
const skip = new Set(excl.split(",").filter(Boolean));
const tree = new Set(execFileSync("git", ["-C", wt, "ls-tree", "-r", "-z", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 1 << 30 }).split("\0"));
const db = new DatabaseSync(store, { readOnly: true });
// newest run per file, then that run's summed durations for the file
const rows = db.prepare(`
  with r as (select c.project, c.test_path, r.run_id, r.recorded_at, r.duration_ms from results r join checks c on c.id = r.check_id where c.kind = 'test'),
  newest as (select project, test_path, run_id, max(recorded_at) t from r group by project, test_path)
  select r.project, r.test_path, sum(r.duration_ms) ms from r join newest n
    on n.project = r.project and n.test_path = r.test_path and n.run_id = r.run_id group by r.project, r.test_path`).all();
const files = rows.filter((r) => tree.has(r.test_path) && !skip.has(r.project)).map((r) => r.ms / 1000).sort((a, b) => a - b);
const q = (p) => files[Math.min(files.length - 1, Math.floor(p * files.length))];
const sum = files.reduce((a, b) => a + b, 0);
const est = (share, width) => {
  // the share's files in a fixed spread: every k-th file of the sorted list, so long and short ones both count
  const pick = files.filter((_, i) => (i * share) % 1 + share >= 1 || share === 1);
  const s = pick.reduce((a, b) => a + b, 0);
  return Math.round(Math.max(pick.at(-1) ?? 0, s / width));
};
const out = { store, files: files.length, sumSeconds: Math.round(sum), median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p99: +q(0.99).toFixed(1), max: +files.at(-1).toFixed(1), wallSeconds: {} };
for (const share of [0.1, 0.25, 0.5, 0.75, 1]) for (const width of [4, 12]) out.wallSeconds[`share${share}_width${width}`] = est(share, width);
console.log(JSON.stringify(out));
