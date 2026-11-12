// Throwaway probe for research 021-27. Reads one .heapsnapshot and prints:
//   1. self size by node type, and the top constructors / string kinds by self size;
//   2. the dominator tree from the root, every node retaining >= --min MiB (default 4), to
//      --depth levels (default 14), with the edge that reaches it: what holds the heap.
// Retained sizes come from the immediate-dominator tree (Cooper, Harvey and Kennedy's
// iterative algorithm), with weak edges left out, as DevTools does.
// Usage: node --max-old-space-size=6144 dominators.mjs <file.heapsnapshot> [--min 4] [--depth 14]
import { readFileSync } from "node:fs";

const file = process.argv[2];
const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const MIN = arg("--min", 4) * 2 ** 20;
const DEPTH = arg("--depth", 14);
const snap = JSON.parse(readFileSync(file, "utf8"));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length;
const EF = meta.edge_fields.length;
const nTypes = meta.node_types[0];
const eTypes = meta.edge_types[0];
const iType = meta.node_fields.indexOf("type");
const iName = meta.node_fields.indexOf("name");
const iSelf = meta.node_fields.indexOf("self_size");
const iEdges = meta.node_fields.indexOf("edge_count");
const eiType = meta.edge_fields.indexOf("type");
const eiName = meta.edge_fields.indexOf("name_or_index");
const eiTo = meta.edge_fields.indexOf("to_node");
const nodes = snap.nodes;
const edges = snap.edges;
const strings = snap.strings;
const N = nodes.length / NF;
const WEAK = eTypes.indexOf("weak");
const ELEMENT = eTypes.indexOf("element");
const HIDDEN = eTypes.indexOf("hidden");
const firstEdge = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) {
  firstEdge[i] = e;
  e += nodes[i * NF + iEdges] * EF;
  firstEdge[i + 1] = e;
}
const type = (i) => nTypes[nodes[i * NF + iType]];
const name = (i) => strings[nodes[i * NF + iName]];
const self = (i) => nodes[i * NF + iSelf];
const label = (i) => {
  const t = type(i);
  const n = name(i);
  if (t === "string" || t === "concatenated string" || t === "sliced string")
    return `${t} ${JSON.stringify(n.slice(0, 60))}${n.length > 60 ? "…" : ""}`;
  return `${t} ${n.slice(0, 90)}`;
};
const edgeLabel = (e) => {
  const t = edges[e + eiType];
  const v = edges[e + eiName];
  const tn = eTypes[t];
  if (t === ELEMENT || t === HIDDEN) return `[${v}]`;
  return `${tn === "property" ? "" : `${tn}:`}${strings[v]}`;
};

// 1. Self size by type and by constructor.
const byType = new Map();
const byCtor = new Map();
let total = 0;
for (let i = 0; i < N; i++) {
  const s = self(i);
  total += s;
  const t = type(i);
  byType.set(t, (byType.get(t) ?? 0) + s);
  const k = t === "object" || t === "closure" || t === "native" ? `${t} ${name(i).slice(0, 80)}` : t;
  const c = byCtor.get(k) ?? [0, 0];
  c[0] += s;
  c[1] += 1;
  byCtor.set(k, c);
}
const mib = (b) => (b / 2 ** 20).toFixed(1);
console.log(`# ${file}\n# ${N} nodes, ${edges.length / EF} edges, self size total ${mib(total)} MiB\n`);
console.log("## Self size by node type (MiB)");
for (const [t, s] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`${mib(s).padStart(8)}  ${t}`);
console.log("\n## Top 40 by self size: object/closure/native by constructor, others by type (MiB, count)");
for (const [k, [s, n]] of [...byCtor].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40))
  console.log(`${mib(s).padStart(8)} ${String(n).padStart(9)}  ${k}`);

// 2. Dominators. Iterative DFS from the root (node 0) for a postorder, weak edges left out.
const post = new Int32Array(N).fill(-1); // node -> postorder number
const order = new Int32Array(N); // postorder number -> node
const parentEdge = new Int32Array(N).fill(-1);
const stackNode = new Int32Array(N);
const stackEdge = new Uint32Array(N);
const seen = new Uint8Array(N);
let sp = 0;
let count = 0;
stackNode[0] = 0;
stackEdge[0] = firstEdge[0];
seen[0] = 1;
sp = 1;
while (sp > 0) {
  const v = stackNode[sp - 1];
  const e = stackEdge[sp - 1];
  if (e < firstEdge[v + 1]) {
    stackEdge[sp - 1] = e + EF;
    if (edges[e + eiType] === WEAK) continue;
    const w = edges[e + eiTo] / NF;
    if (seen[w]) continue;
    seen[w] = 1;
    parentEdge[w] = e;
    stackNode[sp] = w;
    stackEdge[sp] = firstEdge[w];
    sp += 1;
  } else {
    post[v] = count;
    order[count] = v;
    count += 1;
    sp -= 1;
  }
}
// Predecessors in CSR form over reachable nodes, by postorder number.
const predCount = new Uint32Array(count + 1);
for (let v = 0; v < N; v++) {
  if (post[v] < 0) continue;
  for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += EF) {
    if (edges[e + eiType] === WEAK) continue;
    const w = edges[e + eiTo] / NF;
    if (post[w] >= 0) predCount[post[w] + 1] += 1;
  }
}
for (let i = 0; i < count; i++) predCount[i + 1] += predCount[i];
const preds = new Int32Array(predCount[count]);
const fill = predCount.slice(0, count);
for (let v = 0; v < N; v++) {
  if (post[v] < 0) continue;
  for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += EF) {
    if (edges[e + eiType] === WEAK) continue;
    const w = edges[e + eiTo] / NF;
    if (post[w] >= 0) preds[fill[post[w]]++] = post[v];
  }
}
const root = count - 1;
const idom = new Int32Array(count).fill(-1);
idom[root] = root;
let changed = true;
let passes = 0;
while (changed) {
  changed = false;
  passes += 1;
  for (let b = root - 1; b >= 0; b--) {
    let nd = -1;
    for (let k = predCount[b]; k < predCount[b + 1]; k++) {
      const p = preds[k];
      if (idom[p] < 0) continue;
      if (nd < 0) {
        nd = p;
        continue;
      }
      let f1 = p;
      let f2 = nd;
      while (f1 !== f2) {
        while (f1 < f2) f1 = idom[f1];
        while (f2 < f1) f2 = idom[f2];
      }
      nd = f1;
    }
    if (nd >= 0 && idom[b] !== nd) {
      idom[b] = nd;
      changed = true;
    }
  }
}
const retained = new Float64Array(count);
for (let b = 0; b < count; b++) retained[b] += self(order[b]);
for (let b = 0; b < root; b++) retained[idom[b]] += retained[b];
console.log(`\n## Dominator tree (${passes} passes; reachable ${count} of ${N}; retained by root ${mib(retained[root])} MiB)`);
console.log(`## every node retaining >= ${mib(MIN)} MiB, to depth ${DEPTH}: retained MiB, self, edge from its DFS parent, node`);
const children = new Map();
for (let b = 0; b < root; b++) {
  if (retained[b] < MIN) continue;
  const d = idom[b];
  if (!children.has(d)) children.set(d, []);
  children.get(d).push(b);
}
const walk = (b, depth) => {
  const v = order[b];
  const pe = parentEdge[v];
  const via = pe < 0 ? "" : `${edgeLabel(pe)} ← ${label(Math.floor(pe / EF) === -1 ? 0 : ownerOf(pe))} | `;
  console.log(`${"  ".repeat(depth)}${mib(retained[b])} (${mib(self(v))}) ${via}${label(v)}`);
  if (depth >= DEPTH) return;
  for (const c of (children.get(b) ?? []).sort((x, y) => retained[y] - retained[x])) walk(c, depth + 1);
};
// The node an edge offset belongs to (binary search over firstEdge).
function ownerOf(e) {
  let lo = 0;
  let hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (firstEdge[mid] <= e) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
walk(root, 0);

// 3. With --by-edge a,b,c: for each named property, the total retained size of the nodes that
// edge reaches from their DFS parent and that the parent dominates (owned through that edge).
if (process.argv.includes("--by-edge")) {
  const names = new Set(process.argv[process.argv.indexOf("--by-edge") + 1].split(","));
  const sums = new Map();
  for (let b = 0; b < root; b++) {
    const v = order[b];
    const pe = parentEdge[v];
    if (pe < 0) continue;
    const t = edges[pe + eiType];
    if (t === ELEMENT || t === HIDDEN) continue;
    const en = strings[edges[pe + eiName]];
    if (!names.has(en)) continue;
    const parent = ownerOf(pe);
    if (order[idom[b]] !== parent) continue;
    const key = `${en} ← ${label(parent).slice(0, 40)}`;
    const c = sums.get(key) ?? [0, 0];
    c[0] += retained[b];
    c[1] += 1;
    sums.set(key, c);
  }
  console.log("\n## Retained through named edges (MiB, edges)");
  for (const [k, [s, n]] of [...sums].sort((a, b) => b[1][0] - a[1][0]).slice(0, 30)) console.log(`${mib(s).padStart(8)} ${String(n).padStart(8)}  ${k}`);
}
