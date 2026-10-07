// Throwaway probe (001-102): cost of per-package keys on top of the closure walk.
// Usage: node cost.mjs <perfile.json> <installed lockfile> <worktree root>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readLock, resolve, closure, identity, typesOnly } from "./lockgraph.mjs";
const [pf, lockPath, root] = process.argv.slice(2);
const perfile = JSON.parse(readFileSync(pf, "utf8"));
let t = performance.now();
const pk = readLock(lockPath);
const parseMs = performance.now() - t;
t = performance.now();
const typesMemo = new Map();
const isTypes = (l) => typesMemo.get(l) ?? typesMemo.set(l, typesOnly(root, l)).get(l);
const typesMs0 = performance.now();
for (const l of Object.keys(pk)) if (l.includes("node_modules/")) isTypes(l);
const typesMs = performance.now() - typesMs0;
t = performance.now();
const sizes = [];
const memo = new Map();
for (const p of perfile.projects) {
  const env = closure(pk, p.envStarts.map(([f, n]) => resolve(pk, f, n) ?? `absent:${f}:${n}`));
  for (const pairs of Object.values(p.files)) {
    const starts = pairs.map(([f, n]) => resolve(pk, f, n) ?? `absent:${f}:${n}`);
    const set = new Set(env);
    for (const s of starts) {
      // Closures of single packages are shared across files; memoize them.
      const c = memo.get(s) ?? memo.set(s, closure(pk, [s])).get(s);
      for (const l of c) set.add(l);
    }
    const ids = [...set].map((l) => (isTypes(l) ? `types-only:${l}` : identity(pk, l))).sort();
    createHash("sha256").update(ids.join("\n")).digest("hex");
    sizes.push([set.size, set.size - env.size]);
  }
}
const keyMs = performance.now() - t;
const own = sizes.map((s) => s[1]).sort((a, b) => a - b);
console.log(JSON.stringify({ lockEntries: Object.keys(pk).length, parseMs: +parseMs.toFixed(1), typesOnlyScanMs: +typesMs.toFixed(1), typesOnly: [...typesMemo.values()].filter(Boolean).length, files: sizes.length, keyAllFilesMs: +keyMs.toFixed(1), setSize: { min: Math.min(...sizes.map((s) => s[0])), max: Math.max(...sizes.map((s) => s[0])) }, beyondEnv: { median: own[own.length >> 1], max: own.at(-1) } }));
