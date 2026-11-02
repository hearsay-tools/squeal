// Throwaway probe for research 017-26: the live heap of maps shaped as the worker's held
// bytes (Observer.uses: path -> slot -> 40-hex blob) and the host's copies (held, walked,
// lookups: path -> value), at N paths, measured as heapUsed after a GC.
//   node --expose-gc held-replica.mjs <paths> [slotsPerPath]
import { createHash } from "node:crypto";
const n = Number(process.argv[2] ?? 3327);
const slots = Number(process.argv[3] ?? 2);
const hex = (i) => createHash("sha1").update(String(i)).digest("hex");
const used = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
const before = used();
const uses = new Map();
for (let i = 0; i < n; i++) {
  const inner = new Map();
  inner.set("typescript", hex(i));
  for (let s = 1; s < slots; s++) inner.set(`read /x/node_modules/some-plugin/lib/rule-${s}.js`, hex(i * 7 + s));
  uses.set(`packages/svelte/src/internal/client/dom/elements/file-${i}.js`, inner);
}
const worker = used() - before;
const host = new Map([...uses].map(([p, m]) => [p, { typescript: m.get("typescript"), others: [...m.values()].slice(1) }]));
const walked = new Map([...uses].map(([p, m]) => [p, m.get("typescript")]));
const lookups = new Map([...uses].map(([p, m]) => [`${p}.lookup`, m.get("typescript")]));
const hostBytes = used() - before - worker;
console.log(JSON.stringify({ paths: n, slots, workerMapMiB: +(worker / 2 ** 20).toFixed(2), hostMapsMiB: +(hostBytes / 2 ** 20).toFixed(2), keep: uses.size + host.size + walked.size + lookups.size }));
