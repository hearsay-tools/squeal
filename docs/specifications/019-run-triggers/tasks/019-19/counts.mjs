// node counts.mjs <snapshot> <name,name,...> [cut edges]: reachable objects per constructor name.
import { readFileSync } from "node:fs";
const [file, namesText, skipText = ""] = process.argv.slice(2);
const names = new Set(namesText.split(","));
const skip = new Set(skipText.split(",").filter(Boolean));
const snap = JSON.parse(readFileSync(file, "utf8"));
const meta = snap.snapshot.meta; const nf = meta.node_fields, ef = meta.edge_fields;
const nW = nf.length, eW = ef.length; const nTypes = meta.node_types[0], eTypes = meta.edge_types[0];
const N = snap.nodes.length / nW;
const nT = nf.indexOf("type"), nN = nf.indexOf("name"), nE = nf.indexOf("edge_count");
const eT = ef.indexOf("type"), eNm = ef.indexOf("name_or_index"), eTo = ef.indexOf("to_node");
const firstEdge = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) firstEdge[i + 1] = firstEdge[i] + snap.nodes[i * nW + nE];
const seen = new Uint8Array(N); seen[0] = 1; const queue = [0];
for (let q = 0; q < queue.length; q++) { const from = queue[q];
  for (let e = firstEdge[from]; e < firstEdge[from + 1]; e++) { const b = e * eW; const type = eTypes[snap.edges[b + eT]];
    if (type === "weak" || type === "shortcut") continue; const to = snap.edges[b + eTo] / nW; if (seen[to]) continue;
    if ((type === "property" || type === "context") && skip.has(snap.strings[snap.edges[b + eNm]])) continue;
    seen[to] = 1; queue.push(to); } }
const counts = {};
for (let i = 0; i < N; i++) { if (nTypes[snap.nodes[i * nW + nT]] !== "object") continue; const n = snap.strings[snap.nodes[i * nW + nN]];
  if (!names.has(n)) continue; counts[n] ??= [0, 0]; counts[n][1]++; if (seen[i]) counts[n][0]++; }
for (const [n, [r, t]] of Object.entries(counts).sort()) console.log(`${n}: ${r} reachable of ${t}`);
