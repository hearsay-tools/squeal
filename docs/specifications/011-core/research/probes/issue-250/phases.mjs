// Throwaway probe (row 011-408): inclusive ms of the named status phases, one row per .cpuprofile.
// usage: node phases.mjs <file.cpuprofile>...
import { readFileSync } from "node:fs";
const FRAMES = {
  load: ["executeUserEntryPoint", "evaluate"],
  settleIdle: ["(idle)"],
  gc: ["(garbage collector)"],
  read2: ["readOnce"],
  storeOpen: ["openStore"],
  sources: ["sourcePaths"],
  sync: ["syncDaemon"],
  select: ["selectNamedFiles"],
  classes: ["readClasses"],
  snapshot: ["buildSnapshot"],
  imports: ["importsOf"],
  verdict: ["readVerdict"],
  namedFiles: ["readNamedFiles"],
  statesList: ["list"],
  header: ["readHeader"],
  render: ["json", "printNamed", "namedPrint", "formatNamed"],
};
const rows = [];
for (const file of process.argv.slice(2)) {
  const p = JSON.parse(readFileSync(file, "utf8"));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const sums = Object.fromEntries(Object.keys(FRAMES).map((k) => [k, 0]));
  let total = 0;
  p.samples.forEach((id, i) => {
    const us = p.timeDeltas[i] ?? 0;
    total += us;
    const names = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) names.add(byId.get(cur).callFrame.functionName);
    for (const [k, fs] of Object.entries(FRAMES)) if (fs.some((f) => names.has(f))) sums[k] += us;
  });
  rows.push({ file: file.split("/").slice(-2).join("/").slice(0, 12), total: Math.round(total / 1000), ...Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, Math.round(v / 1000)])) });
}
console.table(rows);
