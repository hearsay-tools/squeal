// Row 019-12: shortest retainer paths in a V8 heap snapshot (tasks/019-12/notes.md). Usage:
//   node --max-old-space-size=4096 retainers.mjs <file.heapsnapshot> <constructor> [<edge names to cut, comma-separated>]
// Prints, for each node of a constructor name, a shortest retainer path from the GC roots.
import { readFileSync } from "node:fs";
const [file, target, skipText = ""] = process.argv.slice(2);
// Edge names to treat as cut, as a patch that drops them would (e.g. "onInit,current").
const skip = new Set(skipText.split(",").filter(Boolean));
const snap = JSON.parse(readFileSync(file, "utf8"));
const meta = snap.snapshot.meta;
const nf = meta.node_fields, ef = meta.edge_fields;
const nW = nf.length, eW = ef.length;
const nTypes = meta.node_types[0], eTypes = meta.edge_types[0];
const N = snap.nodes.length / nW;
const nT = nf.indexOf("type"), nN = nf.indexOf("name"), nId = nf.indexOf("id"), nE = nf.indexOf("edge_count");
const eT = ef.indexOf("type"), eNm = ef.indexOf("name_or_index"), eTo = ef.indexOf("to_node");
const firstEdge = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) firstEdge[i + 1] = firstEdge[i] + snap.nodes[i * nW + nE];
const name = (i) => `${nTypes[snap.nodes[i * nW + nT]]}:${snap.strings[snap.nodes[i * nW + nN]]}`.slice(0, 90);
// BFS from root (node 0), skipping weak edges, recording parent and edge.
const parent = new Int32Array(N).fill(-1), via = new Array(N);
parent[0] = 0;
const queue = [0];
for (let q = 0; q < queue.length; q++) {
  const from = queue[q];
  for (let e = firstEdge[from]; e < firstEdge[from + 1]; e++) {
    const base = e * eW;
    const type = eTypes[snap.edges[base + eT]];
    if (type === "weak" || type === "shortcut") continue;
    const to = snap.edges[base + eTo] / nW;
    if (parent[to] !== -1) continue;
    const n = snap.edges[base + eNm];
    if ((type === "property" || type === "context") && skip.has(snap.strings[n])) continue;
    parent[to] = from;
    via[to] = `${type}:${type === "element" || type === "hidden" ? n : snap.strings[n]}`;
    queue.push(to);
  }
}
let shown = 0, total = 0, reached = 0;
for (let i = 0; i < N; i++) if (name(i) === `object:${target}`) { total++; if (parent[i] !== -1) reached++; }
console.log(`${target}: ${reached} of ${total} reachable`);
for (let i = 0; i < N; i++) {
  if (name(i) !== `object:${target}` || parent[i] === -1) continue;
  const path = [];
  for (let at = i; at !== 0 && path.length < 40; at = parent[at]) {
    if (parent[at] === -1) { path.push("(unreachable)"); break; }
    path.push(`${name(at)} <-[${via[at]}]`);
  }
  console.log(`#${++shown} id ${snap.nodes[i * nW + nId]}\n  ${path.join("\n  ")}\n`);
  if (shown >= 3) break;
}
