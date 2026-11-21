import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const by = new Map(); let total = 0;
prof.samples.forEach((id, i) => {
  const t = prof.timeDeltas[i] ?? 0; total += t;
  const url = byId.get(id).callFrame.url;
  const k = url === "" ? `(${byId.get(id).callFrame.functionName || "native"})` : url.includes("node_modules") ? url.replace(/.*node_modules\/(\.pnpm\/)?((@[^/]+\/)?[^/@]+).*/, "pkg:$2") : url.replace(/.*\/(dist\/[^?]*)/, "$1");
  by.set(k, (by.get(k) ?? 0) + t);
});
for (const [k, t] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(t / 1e6).toFixed(2).padStart(7)} s ${((100 * t) / total).toFixed(1).padStart(5)}%  ${k}`);
