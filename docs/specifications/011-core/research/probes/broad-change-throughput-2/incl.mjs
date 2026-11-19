// incl.mjs <profile> <clock> <edits.tsv> [N]: per window, inclusive and self seconds per function name (top N)
import { readFileSync } from "node:fs";
const [pf, clockFile, editsFile, N = 25] = process.argv.slice(2);
const [epochMs, monoUs] = readFileSync(clockFile, "utf8").trim().split(/\s+/).map(Number);
const toMono = (ms) => monoUs + (ms - epochMs) * 1000;
const prof = JSON.parse(readFileSync(pf, "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n])); const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const nm = (n) => `${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
let t = prof.startTime; const times = prof.timeDeltas.map((d) => (t += d));
for (const l of readFileSync(editsFile, "utf8").trim().split("\n")) {
  const [ts, label, , , end] = l.split("\t");
  const from = toMono(+ts), to = end === "-" ? toMono(+ts + 30000) : toMono(+end);
  const incl = new Map(), self = new Map(); let busy = 0, tot = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    if (times[i] < from || times[i] > to) continue;
    const dt = (prof.timeDeltas[i + 1] ?? 0) / 1e6; tot += dt;
    const node = byId.get(prof.samples[i]); const name = node.callFrame.functionName;
    if (name === "(idle)" || name === "(program)") continue;
    busy += dt; self.set(nm(node), (self.get(nm(node)) ?? 0) + dt);
    const seen = new Set();
    for (let x = node.id; x !== undefined; x = parent.get(x)) { const k = nm(byId.get(x)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); } }
  }
  console.log(`\n## ${label} window ${tot.toFixed(1)} s busy ${busy.toFixed(1)} s`);
  console.log([...incl].sort((a, b) => b[1] - a[1]).slice(0, +N).map(([k, v]) => `  ${v.toFixed(2)} ${k}`).join("\n"));
}
