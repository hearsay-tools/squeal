import { readFileSync } from "node:fs";
const a = JSON.parse(readFileSync(process.argv[2]));
const REL = Date.parse("2026-11-19T18:38:45Z"), FIRSTNEW = Date.parse("2026-11-19T21:07:41Z");
const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (xs, d=0) => xs.length ? `n=${xs.length} p50=${q(xs,.5).toFixed(d)} p90=${q(xs,.9).toFixed(d)} max=${Math.max(...xs).toFixed(d)}` : "n=0";
const withLog = a.filter((r) => r.log && r.keying.at >= r.log.start - 60_000 && r.keying.at <= r.log.end + 60_000);
const full = withLog.filter((r) => r.files > 1000 && r.misses >= 0.5 * r.files);
for (const [name, f] of [["pre", full.filter(r => r.keying.at < REL)], ["post", full.filter(r => r.keying.at >= FIRSTNEW)]]) {
  const done = f.filter(r => r.pending === 0 && r.lastPart);
  const active = done.map(r => { const span = (r.lastPart - r.keying.at)/1000; const w = r.gaps.reduce((t,x)=>t+x.s,0); return { span, w, parts: r.parts, files: r.linted }; });
  console.log(`== ${name}`);
  console.log(" completed: parts", fmt(active.map(x=>x.parts)), "s per part without waits >=10s", fmt(active.map(x=>(x.span-x.w)/x.parts),1));
  console.log(" completed: files per minute overall", fmt(active.map(x=>x.files/(x.span/60))));
  const open = f.filter(r => r.pending > 0);
  console.log(" left pending: daemon lived after keying (min)", fmt(open.map(r => (r.log.end - r.keying.at)/60000)));
  console.log(" left pending: linted share %", fmt(open.map(r => 100*r.linted/r.misses)));
  console.log(" left pending with daemon up >= 10 min after keying:", open.filter(r => r.log.end - r.keying.at >= 600e3).length, "; >= 30 min:", open.filter(r => r.log.end - r.keying.at >= 1800e3).length);
  console.log(" any part linted within 120 s of keying:", f.filter(r=>r.firstPart && r.firstPart - r.keying.at <= 120e3).length, "of", f.length, "; done within 120 s:", done.filter(r=>r.lastPart-r.keying.at<=120e3).length);
}
