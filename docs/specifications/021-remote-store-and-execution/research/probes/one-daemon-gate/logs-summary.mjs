// Throwaway (row 021-17). Read only. Summarises the daemon logs of row 021-32
// (<commonDir>/squeal/logs/daemon-<worktree id>.log and .log.1): D3's long-write
// lines per store, the busy notes of the retried path (busy.ts), and every
// "database is locked" line, per project and per UTC day.
// Usage: node logs-summary.mjs <since ISO> <until ISO> <commonDir>...
import { readFileSync, readdirSync } from "node:fs";
const [since, until, ...dirs] = process.argv.slice(2);
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (a) => ({ n: a.length, p50: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), max: a.length ? Math.max(...a) : null, sumS: Math.round(a.reduce((x, y) => x + y, 0) / 1000) });
const LINE = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;
const LONG = /^long write: (\S+) write lock held (\d+) ms by (.+?); (.*)$/;
const BUSY = /^the store was busy for ([\d.]+) s \(another connection held its write lock\); ran once it was free: (.*)$/;
const out = {};
for (const dir of dirs) {
  const project = dir.replace(/^.*\/projects\//, "").replace(/\/\.git\/squeal.*$/, "");
  const seen = new Set();
  const P = { files: 0, rotated: 0, firstLine: null, lastLine: null, long: {}, busy: [], busyOps: {}, busyByDay: {}, locked: {}, lockedByDay: {}, longByDay: {}, ops: {}, zero: {} };
  for (const f of readdirSync(`${dir}/logs`)) {
    if (!/^daemon-.*\.log(\.1)?$/.test(f)) continue;
    P.files++; if (f.endsWith(".1")) P.rotated++;
    for (const line of readFileSync(`${dir}/logs/${f}`, "utf8").split("\n")) {
      const m = LINE.exec(line); if (!m) continue;
      const [, at, , text] = m; if (at < since || at >= until) continue;
      if (seen.has(line)) continue; seen.add(line);
      if (!P.firstLine || at < P.firstLine) P.firstLine = at; if (!P.lastLine || at > P.lastLine) P.lastLine = at;
      const day = at.slice(0, 10);
      let l;
      if ((l = LONG.exec(text))) {
        const [, db, ms, by] = l; const fr = by.split(" < "); const op = (fr[0].startsWith("squeal.mjs:") ? ["(bundle line)", ...fr.slice(1)] : fr).slice(0, 3).join(" < "); const rows = Number((/^(\d+) row/.exec(l[4]) ?? [0, -1])[1]);
        if (rows === 0) { (P.zero[db] ??= []).push(Number(ms)); }
        (P.long[db] ??= []).push(Number(ms));
        ((P.longByDay[db] ??= {})[day] ??= []).push(Number(ms));
        const o = ((P.ops[db] ??= {})[op] ??= []); o.push(Number(ms));
      } else if ((l = BUSY.exec(text))) {
        const ms = Number(l[1]) * 1000; P.busy.push(ms); (P.busyByDay[day] ??= []).push(ms);
        for (const w of l[2].split(", ")) P.busyOps[w.replace(/[0-9a-f]{8,}|\d+/g, "N")] = (P.busyOps[w.replace(/[0-9a-f]{8,}|\d+/g, "N")] ?? 0) + 1;
      } else if (text.includes("database is locked")) {
        const k = text.replace(/\(runner closure of .*?failed: .*?\)/, "(runner closure ... failed ...)").slice(0, 90);
        P.locked[k] = (P.locked[k] ?? 0) + 1; P.lockedByDay[day] = (P.lockedByDay[day] ?? 0) + 1;
      }
    }
  }
  const r = { files: P.files, rotatedWorktrees: P.rotated, firstLine: P.firstLine, lastLine: P.lastLine, long: {}, busyNotes: { ...stat(P.busy), byDay: Object.fromEntries(Object.entries(P.busyByDay).sort().map(([d, a]) => [d, stat(a)])), waited: Object.fromEntries(Object.entries(P.busyOps).sort((a, b) => b[1] - a[1]).slice(0, 12)) }, locked: Object.fromEntries(Object.entries(P.locked).sort((a, b) => b[1] - a[1])), lockedByDay: P.lockedByDay };
  for (const [db, a] of Object.entries(P.long)) {
    r.long[db] = { ...stat(a), over1s: a.filter((x) => x >= 1000).length, over2s: a.filter((x) => x >= 2000).length, over5s: a.filter((x) => x >= 5000).length, zeroRows: stat(P.zero[db] ?? []),
      byDay: Object.fromEntries(Object.entries(P.longByDay[db]).sort().map(([d, x]) => [d, stat(x)])),
      topOpsByTotal: Object.fromEntries(Object.entries(P.ops[db]).map(([o, x]) => [o, stat(x)]).sort((a, b) => b[1].sumS - a[1].sumS).slice(0, 12)) };
  }
  out[project] = r;
}
console.log(JSON.stringify(out, null, 1));
