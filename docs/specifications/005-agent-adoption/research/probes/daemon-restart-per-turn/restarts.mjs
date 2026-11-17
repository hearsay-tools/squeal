// Throwaway probe for row 005-99 (see README.md). Read-only. From the daemon logs alone: for each
// daemon that reached "serving" since SINCE, the stop reason of the worktree's previous daemon
// and the time from that stop to this daemon's first line. Prints counts per reason and gap.
// Usage: node restarts.mjs <repo-dir>
import { join } from "node:path";
import { daemons } from "./lib.mjs";

const SINCE = Date.parse(process.env.SINCE ?? "2026-11-14T00:00:00Z");
const { byLog } = daemons(join(process.argv[2], ".git/squeal/logs"));
const counts = {};
let total = 0;
let lo = Infinity;
let hi = 0;
// ONLY=<worktree id> or SKIP=<worktree id> limits the logs read.
for (const [id, list] of byLog) {
  if (process.env.ONLY !== undefined && id !== process.env.ONLY) continue;
  if (process.env.SKIP !== undefined && id === process.env.SKIP) continue;
  const served = list.filter((p) => p.serving !== null).sort((a, b) => a.first - b.first);
  for (let i = 0; i < served.length; i++) {
    const p = served[i];
    if (p.first < SINCE) continue;
    total++;
    lo = Math.min(lo, p.first);
    hi = Math.max(hi, p.first);
    const prev = served[i - 1];
    let key = "first in log";
    if (prev !== undefined && prev.stop !== null) {
      const gap = (p.first - prev.stop) / 60_000;
      const bucket = gap <= 5 ? "<=5m" : gap <= 15 ? "<=15m" : gap <= 60 ? "<=60m" : ">60m";
      key = `${(prev.reason ?? "").slice(0, 34)} | ${bucket}`;
    } else if (prev !== undefined) key = "previous has no stop line";
    counts[key] = (counts[key] ?? 0) + 1;
  }
}
console.log(process.argv[2].split("/").pop(), "starts", total, "days", ((hi - lo) / 864e5).toFixed(2));
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), k);
