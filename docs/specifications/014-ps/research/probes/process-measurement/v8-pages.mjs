// Throwaway probe for research 014-02: does a Node process's JS heap show in /proc/self/smaps
// as anonymous mappings of exactly 256 KiB? Grows the JS heap by about 400 MB of objects and a
// native Buffer of 300 MB, and counts the mappings before and after against
// process.memoryUsage(). Touches no other process.
import { readFileSync } from "node:fs";
function anon() {
  const out = { page256: { n: 0, rssMiB: 0 }, other: { n: 0, rssMiB: 0 } };
  let cur = null;
  for (const l of readFileSync("/proc/self/smaps", "latin1").split("\n")) {
    const h = /^([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ \S+\s*(.*)$/.exec(l);
    if (h) cur = h[3].trim() === "" ? ((parseInt(h[2], 16) - parseInt(h[1], 16)) / 1024 === 256 ? out.page256 : out.other) : null, cur && cur.n++;
    else if (cur) { const m = /^Rss:\s+(\d+)/.exec(l); if (m) cur.rssMiB += +m[1] / 1024; }
  }
  for (const v of Object.values(out)) v.rssMiB = +v.rssMiB.toFixed(1);
  return out;
}
const mu = () => Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, +(v / 2 ** 20).toFixed(1)]));
console.log("before", JSON.stringify(anon()), JSON.stringify(mu()));
const keep = [];
for (let i = 0; i < 4_000_000; i++) keep.push({ i, s: `x${i}`, a: [i, i + 1] });
console.log("after JS objects", JSON.stringify(anon()), JSON.stringify(mu()));
const buf = Buffer.alloc(300 * 2 ** 20, 1);
console.log("after 300 MiB Buffer", JSON.stringify(anon()), JSON.stringify(mu()), keep.length > 0, buf.length > 0);
