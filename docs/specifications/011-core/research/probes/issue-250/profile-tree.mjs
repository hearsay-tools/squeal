// Throwaway probe (row 011-408): the call tree under one function of a .cpuprofile, merged by name, with inclusive ms.
// usage: node profile-tree.mjs <file.cpuprofile> <rootFunctionName> [depth] [minMs]
import { readFileSync } from "node:fs";
const [file, rootName, depthArg, minArg] = process.argv.slice(2);
const depth = Number(depthArg ?? 4), minMs = Number(minArg ?? 20);
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const dt = new Map();
p.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
const inclOf = new Map();
const incl = (n) => {
  if (inclOf.has(n.id)) return inclOf.get(n.id);
  let t = dt.get(n.id) ?? 0;
  for (const c of n.children ?? []) t += incl(byId.get(c));
  inclOf.set(n.id, t);
  return t;
};
const name = (n) => `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}`;
// Merge every occurrence of the root (outermost ones only) into one tree keyed by frame names.
const merged = { t: 0, kids: new Map() };
const add = (node, into, d) => {
  into.t += incl(node);
  if (d >= depth) return;
  for (const c of node.children ?? []) {
    const cn = byId.get(c);
    const k = name(cn);
    if (!into.kids.has(k)) into.kids.set(k, { t: 0, kids: new Map() });
    add(cn, into.kids.get(k), d + 1);
  }
};
const walk = (n, inside) => {
  const isRoot = n.callFrame.functionName === rootName;
  if (isRoot && !inside) add(n, merged, 0);
  for (const c of n.children ?? []) walk(byId.get(c), inside || isRoot);
};
walk(p.nodes[0], false);
const print = (node, label, d) => {
  if (node.t / 1000 < minMs) return;
  console.log(`${"  ".repeat(d)}${(node.t / 1000).toFixed(0)} ms ${label}`);
  for (const [k, v] of [...node.kids].sort((a, b) => b[1].t - a[1].t)) print(v, k, d + 1);
};
print(merged, rootName, 0);
