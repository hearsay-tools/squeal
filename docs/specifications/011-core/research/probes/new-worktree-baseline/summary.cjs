// 011-299 probe (throwaway): the first matching class of each first-baseline file run, from classes.cjs output.
// Usage: node summary.cjs <classes.jsonl>
// Order: (a) an earlier run completed the file at the same content and kept no row for it (its row was replaced at
// the same key); (d) another worktree ran it at the same content at the same time; (e-own) the worktree's own
// commits or edits since its start touched the closure; (c) a clean row at the same closure content exists with
// another key; (b) no clean row at the same closure content: the content is new on this host; (e) other.
const fs = require("fs");
const L = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cls = (x) => {
  if (x.cls === "not ended") return "not ended (0 recorded s)";
  if (x.orphanBefore.some((o) => o.sameContent)) return "a  equal content completed earlier, row gone";
  if (x.overlap.some((o) => o.sameContent && (o.orphan || !x.stored))) return "d  parallel duplicate, one row replaced";
  if (x.overlap.some((o) => o.sameContent)) return "d' parallel run at the same content, both rows kept";
  if (x.ownCommitted) return "e-own  own commits since start touched the closure";
  if (x.ownDirty === "touched") return "e-own  own uncommitted edits touched the closure";
  if (x.sameContentY.length > 0) return "c  same closure content stored with another key";
  if (x.X0 === null) return "e  no start commit";
  if (x.nY === 0) return "b0 no clean row for this file before the run";
  return "b  content new on this host";
};
const S = new Map(); let tot = 0;
const add = (k, x) => { const v = S.get(k) ?? { n: 0, sec: 0, ck: new Set() }; v.n++; v.sec += x.sec; v.ck.add(x.ck); S.set(k, v); };
for (const x of L) { tot += x.sec; const c = cls(x); x.c = c; add(c, x); if (x.cls !== "not ended" && x.ownDirty === "unknown" && !c.startsWith("e-own")) add("   of a to c: dirty, removed worktree (own edits not knowable)", x); }
console.log(`file runs ${L.length}, recorded s ${Math.round(tot)}`);
for (const [k, v] of [...S].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(`${(100 * v.sec / tot).toFixed(1).padStart(5)}% ${String(Math.round(v.sec)).padStart(7)} s ${String(v.n).padStart(6)} runs ${String(v.ck.size).padStart(4)} baselines  ${k}`);
// by project within the main classes
const P = {}; for (const x of L) { const k = x.c.slice(0, 2).trim() + " " + x.file.split("\0")[0]; P[k] = (P[k] ?? 0) + x.sec; }
console.log(Object.entries(P).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k} ${Math.round(v)}`).join("\n"));
// live-worktree calibration of the dirty assumption
const live = L.filter((x) => x.cls !== "not ended" && x.live && (x.Xdirty || x.X0dirty));
const t = live.filter((x) => x.ownDirty === "touched").reduce((s, x) => s + x.sec, 0), all = live.reduce((s, x) => s + x.sec, 0);
console.log(`live dirty file runs: ${live.length}, ${Math.round(all)} s; own edits touched the closure in ${Math.round(t)} s (${(100 * t / all).toFixed(1)}%)`);
fs.writeFileSync(process.argv[2].replace(/\.jsonl$/, ".cls.jsonl"), L.map((x) => JSON.stringify({ ck: x.ck, W: x.W, T: x.T, rs: x.rs, file: x.file, sec: x.sec, c: x.c, X0: x.X0, X: x.X, live: x.live, nY: x.nY, sameContentY: x.sameContentY, fail: x.fail })).join("\n") + "\n");
