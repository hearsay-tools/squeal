// after-prof.mjs <dir> [n]: mean self ms per function after the first sample under runMain.
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2], n = Number(process.argv[3] ?? 30);
const files = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
const self = new Map(); let total = 0;
for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const label = (x) => `${x.callFrame.functionName || "(anon)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber}`;
  let on = false;
  for (let i = 0; i < p.samples.length; i++) {
    if (!on) for (let c = p.samples[i]; c !== undefined; c = parent.get(c)) if (byId.get(c).callFrame.functionName === "runMain") { on = true; break; }
    if (!on) continue;
    const ms = (p.timeDeltas[i + 1] ?? 0) / 1000 / files.length;
    total += ms;
    const l = label(byId.get(p.samples[i]));
    self.set(l, (self.get(l) ?? 0) + ms);
  }
}
console.log(`after runMain: ${total.toFixed(1)} ms mean`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`${v.toFixed(2)}\t${k}`);
