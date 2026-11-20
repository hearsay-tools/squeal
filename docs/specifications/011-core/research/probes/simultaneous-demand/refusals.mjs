// refusals.mjs <label>: the D18 ceiling refusals the daemon logged between
// $OUT/<label>.t0 and .t1. A refused daemon looks again every 2 s, so lines
// less than 5 s apart form one episode: how long the ceiling held a tier
// back. Prints JSON: count, busy CPUs read (min, p50, max), episodes.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const label = process.argv[2];
const OUT = process.env.OUT, REPO = process.env.SQ_REPO;
const t0 = Number(readFileSync(join(OUT, `${label}.t0`), "utf8"));
const t1 = existsSync(join(OUT, `${label}.t1`)) ? Number(readFileSync(join(OUT, `${label}.t1`), "utf8")) : Date.now();
const e0 = Number(readFileSync(join(OUT, `${label}.edits.tsv`), "utf8").split("\t")[0]);
const logDir = join(REPO, ".git/squeal/logs");
const lines = readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), "utf8").split("\n"))
  .filter((l) => l.includes("background ceiling refused"))
  .map((l) => ({ t: Date.parse(l.slice(0, 24)), busy: Number(/: ([\d.]+) busy CPUs/.exec(l)?.[1]), line: l.slice(25) }))
  .filter((r) => r.t >= t0 && r.t <= t1).sort((a, b) => a.t - b.t);
const eps = [];
for (const r of lines) {
  const last = eps.at(-1);
  if (last && r.t - last.end < 5000) { last.end = r.t; last.n++; } else eps.push({ start: r.t, end: r.t, n: 1 });
}
const b = lines.map((r) => r.busy).sort((x, y) => x - y);
const s = (ms) => +((ms - e0) / 1000).toFixed(1);
console.log(JSON.stringify({
  label, count: lines.length,
  busy: b.length ? { min: b[0], p50: b[Math.floor(b.length / 2)], max: b.at(-1) } : null,
  episodes: eps.map((e) => ({ atS: s(e.start), heldS: +((e.end - e.start) / 1000 + 2).toFixed(1), lines: e.n })),
  heldTotalS: +eps.reduce((a, e) => a + (e.end - e.start) / 1000 + 2, 0).toFixed(1),
  sample: lines.slice(0, 3).map((r) => r.line),
}, null, 1));
