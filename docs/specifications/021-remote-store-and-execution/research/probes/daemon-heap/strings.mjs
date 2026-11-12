// Throwaway probe for research 021-27. Reads one .heapsnapshot and prints how much of its string
// self size is copies of one value: total, distinct values, the size if each value were held once,
// and the 20 values with the most bytes in copies. Also counts objects by their property names
// (the shape key), top 15, to name what the plain `Object`s are.
// Usage: node --max-old-space-size=8192 strings.mjs <file.heapsnapshot>
import { readFileSync } from "node:fs";
const snap = JSON.parse(readFileSync(process.argv[2], "utf8"));
const m = snap.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length;
const T = m.node_types[0], ET = m.edge_types[0];
const iT = m.node_fields.indexOf("type"), iN = m.node_fields.indexOf("name"), iS = m.node_fields.indexOf("self_size"), iE = m.node_fields.indexOf("edge_count");
const { nodes, edges, strings } = snap;
const N = nodes.length / NF;
const mib = (b) => (b / 2 ** 20).toFixed(1);
const byValue = new Map();
let total = 0, count = 0;
const shapes = new Map();
const PROP = ET.indexOf("property");
for (let i = 0, e = 0; i < N; i++) {
  const t = T[nodes[i * NF + iT]], s = nodes[i * NF + iS], ec = nodes[i * NF + iE];
  if (t === "string") {
    const v = strings[nodes[i * NF + iN]];
    total += s; count += 1;
    const c = byValue.get(v) ?? [0, 0, s];
    c[0] += s; c[1] += 1; byValue.set(v, c);
  }
  if (t === "object" && strings[nodes[i * NF + iN]] === "Object") {
    const props = [];
    for (let k = 0; k < ec; k++) if (edges[e + k * EF] === PROP) props.push(strings[edges[e + k * EF + 1]]);
    const key = props.filter((p) => p !== "__proto__").sort().join(",").slice(0, 100);
    const c = shapes.get(key) ?? [0, 0]; c[0] += 1; c[1] += s; shapes.set(key, c);
  }
  e += ec * EF;
}
let once = 0;
for (const [, [, , one]] of byValue) once += one;
console.log(`strings: ${count} nodes, ${mib(total)} MiB; ${byValue.size} distinct values; held once each: ${mib(once)} MiB; copies: ${mib(total - once)} MiB`);
console.log("\ntop 20 values by bytes in copies (MiB in copies, copies, value)");
for (const [v, [s, n, one]] of [...byValue].sort((a, b) => b[1][0] - b[1][2] - (a[1][0] - a[1][2])).slice(0, 20))
  console.log(`${mib(s - one).padStart(7)} ${String(n).padStart(8)}  ${JSON.stringify(v.slice(0, 90))}`);
const hex40 = [...byValue].filter(([v]) => /^[0-9a-f]{40}$/.test(v));
const paths = [...byValue].filter(([v]) => /\//.test(v) && v.length < 300);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
console.log(`\n40-hex values (sha1): ${hex40.length} distinct, ${sum(hex40, ([, c]) => c[1])} nodes, ${mib(sum(hex40, ([, c]) => c[0]))} MiB`);
console.log(`values with a '/' (paths): ${paths.length} distinct, ${sum(paths, ([, c]) => c[1])} nodes, ${mib(sum(paths, ([, c]) => c[0]))} MiB, once ${mib(sum(paths, ([, c]) => c[2]))} MiB`);
console.log("\nplain Objects by property names, top 15 (count, self MiB, names)");
for (const [k, [n, s]] of [...shapes].sort((a, b) => b[1][0] - a[1][0]).slice(0, 15)) console.log(`${String(n).padStart(8)} ${mib(s).padStart(6)}  ${k}`);
