// Throwaway (row 021-03). Busy-store and lock notes the daemons persisted in a
// COPY of a store (meta "notes" keys, newest MAX_PERSISTED_NOTES per worktree).
// Usage: node busy-notes.mjs <copy of store.sqlite>
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE '%notes%'").all();
let all = 0, oldest = Infinity, newest = 0;
const busy = [], locked = [], other = [];
for (const { key, value } of rows) {
  let list; try { list = JSON.parse(value); } catch { continue; }
  if (!Array.isArray(list)) continue;
  for (const n of list) {
    if (typeof n?.text !== "string") continue;
    all++; oldest = Math.min(oldest, n.at); newest = Math.max(newest, n.at);
    const m = /store was busy for ([\d.]+) s .*ran once it was free: (.*)$/.exec(n.text);
    if (m) busy.push({ at: n.at, s: Number(m[1]), what: m[2], key });
    else if (/locked|busy/i.test(n.text)) locked.push({ at: n.at, text: n.text.slice(0, 160), key });
  }
}
const iso = (t) => new Date(t).toISOString().slice(0, 16);
console.log(`notes ${all} in ${rows.length} keys, ${iso(oldest)} .. ${iso(newest)}`);
busy.sort((a, b) => a.s - b.s);
const q = (p) => busy[Math.min(busy.length - 1, Math.floor(p * busy.length))]?.s;
console.log(`busy episodes ${busy.length}; seconds p50 ${q(0.5)} p90 ${q(0.9)} max ${busy.at(-1)?.s}`);
for (const lim of [1, 2, 5, 10, 30, 60]) console.log(`  >= ${lim} s: ${busy.filter((b) => b.s >= lim).length}`);
const kinds = new Map();
for (const b of busy) for (const w of b.what.split(", ")) { const k = w.replace(/\d+/g, "N"); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
console.log("what waited:", [...kinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; "));
console.log("longest 8:"); for (const b of busy.slice(-8)) console.log(`  ${iso(b.at)} ${b.s} s: ${b.what.slice(0, 140)}`);
const byText = new Map();
for (const l of locked) { const k = l.text.replace(/\d+/g, "N").slice(0, 100); const e = byText.get(k) ?? { n: 0, last: 0 }; e.n++; e.last = Math.max(e.last, l.at); byText.set(k, e); }
console.log(`other lock/busy notes ${locked.length}:`); for (const [k, e] of [...byText].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${e.n} x (last ${iso(e.last)}) ${k}`);
