// Throwaway probe P3 (014-01): ties each daemon's lock file and the pool's
// permit files to the pid that holds them through /proc/locks, read-only.
// Lock files are stat'ed, never opened.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const t0 = performance.now();
const locks = new Map(); // "maj:min:ino" -> [{pid, type}]
for (const line of readFileSync("/proc/locks", "utf8").split("\n")) {
  const m = /^\d+: (\w+)\s+(\w+)\s+(\w+)\s+(-?\d+) ([0-9a-f]+):([0-9a-f]+):(\d+) /.exec(line);
  if (!m) continue;
  const key = `${parseInt(m[5], 16)}:${parseInt(m[6], 16)}:${m[7]}`;
  if (!locks.has(key)) locks.set(key, []);
  locks.get(key).push({ kind: m[1], mode: m[3], pid: Number(m[4]) });
}
const tLocks = performance.now();
const keyOf = (s) => `${(s.dev >> 8) & 0xfff}:${(s.dev & 0xff) | ((s.dev >> 12) & 0xfff00)}:${s.ino}`;
const report = (dir) => {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith(".sqlite") || n.endsWith(".lock")).map((n) => {
    const s = statSync(join(dir, n));
    const holders = locks.get(keyOf(s)) ?? [];
    return { file: n, holders: [...new Set(holders.map((h) => `${h.kind}/${h.mode}/${h.pid}`))] };
  });
};
const out = { load1: readFileSync("/proc/loadavg", "utf8").split(" ")[0], procLocksLines: [...locks.values()].flat().length };
for (const dir of process.argv.slice(2)) {
  const r = report(dir);
  const held = r.filter((x) => x.holders.length > 0);
  out[dir.replace(process.env.HOME, "~")] = { files: r.length, held: held.length, holders: held.map((x) => `${x.file} ${x.holders.join(",")}`) };
}
out.ms = +(tLocks - t0).toFixed(1);
console.log(JSON.stringify(out, null, 1));
