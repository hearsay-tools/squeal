// Throwaway (row 021-17). Read only. From the daemon logs' long-write lines
// (D3: a write transaction over 250 ms, logged at its end with its length),
// the share of each fixed 25-minute window that one store's write lock was
// held by such holds alone, clipped to the window. Holds on one store never
// overlap (one writer at a time), so the sum is a lower bound on the share
// held: shorter holds and hooks' or commands' holds are not logged.
// "<db> without prune" repeats it with the prune holds (long-writes.mjs) left out.
// Also the number of distinct daemon pids that logged in each window.
// Usage: node log-windows.mjs <since ISO> <until ISO> <commonDir>...
import { readFileSync, readdirSync } from "node:fs";
import { isPrune } from "./long-writes.mjs";
const [since, until, ...dirs] = process.argv.slice(2);
const W = 25 * 60_000, s0 = Date.parse(since), s1 = Date.parse(until);
const LINE = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;
const LONG = /^long write: (\S+) write lock held (\d+) ms by (.+?); /;
for (const dir of dirs) {
  const project = dir.replace(/^.*\/projects\//, "").replace(/\/\.git\/squeal.*$/, "");
  const seen = new Set(); const held = {}; const pids = {};
  for (const f of readdirSync(`${dir}/logs`)) {
    if (!/^daemon-.*\.log(\.1)?$/.test(f)) continue;
    for (const line of readFileSync(`${dir}/logs/${f}`, "utf8").split("\n")) {
      const m = LINE.exec(line); if (!m || seen.has(line)) continue; seen.add(line);
      const end = Date.parse(m[1]); if (end < s0 || end >= s1) continue;
      (pids[Math.floor((end - s0) / W)] ??= new Set()).add(m[2]);
      const l = LONG.exec(m[3]); if (!l) continue;
      const a = end - Number(l[2]); const db = l[1]; const H = (held[db] ??= {}); const Hp = (held[`${db} without prune`] ??= {}); const prune = isPrune(l[3]);
      for (let w = Math.floor((a - s0) / W); w * W + s0 < end; w++) {
        const x = Math.max(a, s0 + w * W), y = Math.min(end, s0 + (w + 1) * W); if (y > x) { H[w] = (H[w] ?? 0) + (y - x); if (!prune) Hp[w] = (Hp[w] ?? 0) + (y - x); }
      }
    }
  }
  const n = Math.floor((s1 - s0) / W);
  for (const [db, H] of Object.entries(held)) {
    const shares = Array.from({ length: n }, (_, w) => (H[w] ?? 0) / W).sort((a, b) => a - b);
    const q = (p) => (100 * shares[Math.min(n - 1, Math.floor(p * n))]).toFixed(1);
    const top = Object.entries(H).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, ms]) => `${new Date(s0 + w * W).toISOString().slice(5, 16)} ${(100 * ms / W).toFixed(0)}% (${pids[w]?.size ?? 0} daemons logging)`);
    console.log(`${project} ${db}: ${n} windows of 25 min; share held by logged long holds p50 ${q(0.5)}%, p90 ${q(0.9)}%, p99 ${q(0.99)}%, max ${(100 * shares[n - 1]).toFixed(1)}%; windows over 50%: ${shares.filter((s) => s > 0.5).length}, over 25%: ${shares.filter((s) => s > 0.25).length}`);
    console.log(`  top: ${top.join("; ")}`);
  }
}
