// profall.mjs <dir> [n] [filter]: mean self and inclusive ms per function over every profile in dir.
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2], n = Number(process.argv[3] ?? 40), filt = new RegExp(process.argv[4] ?? ".");
const files = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"));
const self = new Map(), incl = new Map();
for (const f of files) {
  const p = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const label = (x) => `${x.callFrame.functionName || "(anon)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber}`;
  for (let i = 0; i < p.samples.length; i++) {
    const ms = (p.timeDeltas[i + 1] ?? 0) / 1000 / files.length;
    const id = p.samples[i];
    const l0 = label(byId.get(id));
    self.set(l0, (self.get(l0) ?? 0) + ms);
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const l = label(byId.get(cur));
      if (seen.has(l)) continue; seen.add(l);
      incl.set(l, (incl.get(l) ?? 0) + ms);
    }
  }
}
const top = (m, f) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(2)}\t${k}`).join("\n");
console.log(`${files.length} profiles\n== self\n` + top(self, (k) => filt.test(k)));
console.log("== inclusive\n" + top(incl, (k) => k.includes(".mjs:") && filt.test(k)));
