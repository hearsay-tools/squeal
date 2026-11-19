// Throwaway (row 021-17). Summarises ../store-contention/lock-watch.mjs output:
// per database, the share of the window its write lock was held, by holder
// class (daemon, hook <name>, CLI, other), holds of 1 s, 2 s and 5 s or more,
// the longest holds, and the share per 5-minute window. A hold is clipped to
// the window and to each 5-minute bucket (2026-11-11 counted a hold in the
// bucket it started in, so a bucket could pass 100%).
// With commonDirs, the prune holds the daemon logs name (long-writes.mjs) are
// counted apart: (a) prune, (b) everything else = all held time minus (a).
// Prune holds of 250 ms or less are not logged, so (a) is a lower bound.
// Usage: node summarize-locks.mjs <from ISO> <seconds> <lockwatch.jsonl> [commonDir...]
import { readFileSync } from "node:fs";
import { longWrites } from "./long-writes.mjs";
const [fromIso, secs, file, ...dirs] = process.argv.slice(2);
const t0 = Date.parse(fromIso), t1 = t0 + Number(secs) * 1000, W = 300_000;
const prunes = dirs.flatMap((d) => longWrites(d, t0, t1)).filter((w) => w.prune);
const holds = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const kind = (c = "") => /^squeal \S+ daemon @/.test(c) ? "daemon" : /runner-host/.test(c) ? "runner host"
  : (/([a-z-]+)\.mjs\b/.exec(c.replace(/squeal\.mjs/, "")) ? `hook ${/([a-z-]+)\.mjs\b/.exec(c.replace(/squeal\.mjs/, ""))[1]}` : /squeal\.mjs (\S+)/.test(c) ? `cli ${/squeal\.mjs (\S+)/.exec(c)[1]}` : `other ${c.slice(0, 50)}`);
const wt = (c = "") => (/daemon @(\S+)/.exec(c) ?? [, ""])[1];
const by = {};
for (const h of holds) (by[h.db] ??= []).push(h);
for (const [db, hs] of Object.entries(by)) {
  let held = 0; const cls = {}, buckets = {}, daemons = {}; const loads = hs.map((h) => Number(h.load));
  for (const h of hs) {
    const a = Math.max(t0, Date.parse(h.at)), b = Math.min(t1, Date.parse(h.at) + h.ms); if (b <= a) continue;
    held += b - a; const k = kind(h.cmd);
    const c = (cls[k] ??= { holds: 0, ms: 0, max: 0, s1: 0, s2: 0, s5: 0 });
    c.holds++; c.ms += b - a; c.max = Math.max(c.max, h.ms); if (h.ms >= 1000) c.s1++; if (h.ms >= 2000) c.s2++; if (h.ms >= 5000) c.s5++;
    if (k === "daemon") { const d = (daemons[wt(h.cmd)] ??= { ms: 0, holds: 0, max: 0 }); d.ms += b - a; d.holds++; d.max = Math.max(d.max, h.ms); }
    for (let w = t0 + Math.floor((a - t0) / W) * W; w < b; w += W) {
      const x = Math.max(a, w), y = Math.min(b, w + W); const B = (buckets[w] ??= { ms: 0, d: 0 }); B.ms += y - x; if (k === "daemon") B.d += y - x;
    }
  }
  const pc = (ms, of = t1 - t0) => `${((100 * ms) / of).toFixed(1)}%`;
  console.log(`== ${db}: ${hs.length} holds; lock held ${pc(held)} of ${secs} s; load ${Math.min(...loads)}-${Math.max(...loads)}`);
  for (const [k, c] of Object.entries(cls).sort((x, y) => y[1].ms - x[1].ms))
    console.log(`  ${k.padEnd(28)} holds ${String(c.holds).padStart(5)}  share ${pc(c.ms).padStart(6)}  max ${c.max} ms  >=1s ${c.s1}  >=2s ${c.s2}  >=5s ${c.s5}`);
  if (dirs.length) {
    const mine = prunes.filter((w) => `${w.project}/.git/squeal/${w.db}` === db); let a = 0; const pb = {};
    for (const w of mine) { const x = Math.max(t0, w.start), y = Math.min(t1, w.end); if (y <= x) continue; a += y - x;
      for (let k = t0 + Math.floor((x - t0) / W) * W; k < y; k += W) pb[k] = (pb[k] ?? 0) + Math.min(y, k + W) - Math.max(x, k); }
    console.log(`  split: (a) prune holds the logs name ${pc(a)} (${mine.length} holds), (b) everything else ${pc(held - a)}; per 5 min (b): ${Object.entries(buckets).sort().map(([k, B]) => `${new Date(Number(k)).toISOString().slice(11, 16)} ${pc(B.ms - (pb[k] ?? 0), W)}`).join(", ")}`);
  }
  console.log(`  per daemon (worktree: share, holds, max): ${Object.entries(daemons).sort((x, y) => y[1].ms - x[1].ms).map(([w, d]) => `${w} ${pc(d.ms)} ${d.holds} ${d.max}ms`).join("; ")}`);
  console.log(`  per 5 min (all / daemons): ${Object.entries(buckets).sort().map(([w, B]) => `${new Date(Number(w)).toISOString().slice(11, 16)} ${pc(B.ms, W)}/${pc(B.d, W)}`).join(", ")}`);
  console.log(`  longest: ${[...hs].sort((x, y) => y.ms - x.ms).slice(0, 6).map((h) => `${h.at.slice(11, 19)} ${h.ms}ms ${kind(h.cmd)} ${wt(h.cmd)} frames ${h.frames}`).join("; ")}`);
}
