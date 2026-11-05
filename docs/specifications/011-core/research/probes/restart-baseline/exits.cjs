// 011-298 probe (throwaway): why the predecessor daemon stopped, from the `notes.<worktree>` "daemon stopped" notes,
// for restart baselines of worktrees whose notes survive. Usage: node exits.cjs <store copy> <classify output.jsonl>
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const L = fs.readFileSync(process.argv[3], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const notes = new Map();
for (const r of db.prepare("select key, value from meta where key like 'notes.%'").all()) {
  let v; try { v = JSON.parse(r.value); } catch { continue; }
  notes.set(r.key.slice(6), (Array.isArray(v) ? v : []).filter((x) => /daemon stopped/.test(x.text ?? "")));
}
const short = (t) => t.replace(/daemon stopped: /, "").replace(/\(.*$/s, "").replace(/[0-9]+/g, "N").replace(/\/\S+/g, "P").replace(/;.*$/s, "").slice(0, 80).trim();
const B = new Map();
for (const x of L) { const b = B.get(x.ck) ?? { W: x.W, T: x.T, prevT: x.prevT, sec: 0 }; b.sec += x.sec; B.set(x.ck, b); }
const S = {}; let withNotes = 0, all = 0, secAll = 0, secNotes = 0;
for (const b of B.values()) {
  all++; secAll += b.sec;
  const ns = notes.get(b.W); if (!ns) continue;
  const stop = ns.filter((n) => n.at > b.prevT && n.at <= b.T).at(-1);
  const k = stop ? short(stop.text) : "no stop note between the two starts";
  withNotes++; secNotes += b.sec;
  S[k] ??= { n: 0, sec: 0 }; S[k].n++; S[k].sec += b.sec;
}
console.log(`restart baselines ${all} (${Math.round(secAll)} s); with notes ${withNotes} (${Math.round(secNotes)} s)`);
for (const [k, v] of Object.entries(S).sort((a, b) => b[1].sec - a[1].sec)) console.log(`${String(v.n).padStart(4)} restarts ${String(Math.round(v.sec)).padStart(7)} s  ${k}`);
