import { readFileSync } from "node:fs";
const a = JSON.parse(readFileSync(process.argv[2]));
const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (xs) => xs.length ? `n=${xs.length} p50=${Math.round(q(xs,.5))} p90=${Math.round(q(xs,.9))} max=${Math.round(Math.max(...xs))} sum=${Math.round(xs.reduce((s,x)=>s+x,0))}` : "n=0";
const all = a.flatMap(r => r.episodes.map(e => ({ ...e, r })));
const old = all.filter(e => e.format === "old"), neu = all.filter(e => e.format === "new");
console.log("old-format (pre 0.1.570) episodes", old.length, "looks", old.reduce((s,e)=>s+e.looks,0), "span s", fmt(old.map(e => (e.end - e.start)/1000 + 2)));
console.log("  looks below the CPU ceiling (test slots bound it):", old.reduce((s,e)=>s+e.belowCeiling,0), "episodes with any:", old.filter(e=>e.belowCeiling>0).length, "episodes all below:", old.filter(e=>e.belowCeiling===e.looks).length);
console.log("  slots named:", Object.entries(Object.groupBy(old, e=>e.slots+"/"+e.ceiling)).map(([k,v])=>k+":"+v.length).join(" "));
console.log("new-format (0.1.570+) episodes", neu.length, "closed by a grant", neu.filter(e=>e.closed).length);
console.log("  closed lengths s", fmt(neu.filter(e=>e.closed).map(e => (e.end - e.start)/1000)));
console.log("  ceilings", Object.entries(Object.groupBy(neu, e=>e.ceiling)).map(([k,v])=>k+":"+v.length).join(" "));
// during a full re-lint window of that worktree
const inRelint = (e) => { const r = e.r; if (!(r.files > 1000 && r.misses >= 0.5 * r.files)) return false; const end = r.pending > 0 ? r.log.end : r.lastPart; return e.start >= r.keying.at && e.start <= end; };
const nr = neu.filter(inRelint), or = old.filter(inRelint);
console.log("new-format episodes inside a full re-lint:", nr.length, "closed lengths", fmt(nr.filter(e=>e.closed).map(e => (e.end - e.start)/1000)));
console.log("old-format episodes inside a full re-lint:", or.length, "spans", fmt(or.map(e => (e.end - e.start)/1000 + 2)), "below ceiling looks", or.reduce((s,e)=>s+e.belowCeiling,0), "of", or.reduce((s,e)=>s+e.looks,0));
// days covered
const t = all.map(e=>e.start); console.log("window", new Date(Math.min(...t)).toISOString(), new Date(Math.max(...t)).toISOString());
// cpu waits left open
const cw = a.filter(r => r.cpuWait); console.log("open lint cpu-wait records", cw.length, "busy<limit", cw.filter(r=>r.cpuWait.busy!==null && r.cpuWait.busy < r.cpuWait.limit).length, "limits", Object.entries(Object.groupBy(cw, r=>r.cpuWait.limit)).map(([k,v])=>k+":"+v.length).join(" "), "recorded wait s", fmt(cw.map(r => (r.cpuWait.at - r.cpuWait.since)/1000)));
