// Throwaway probe (001-102): per test file, does its per-package key differ between two installs?
// Usage: node compare.mjs <perfile.json> <lockA> <lockB> [trace-summary.json]
// Schemes: "hop" = first-hop packages only; "graph" = their lockfile closure; both plus env-wide closure.
import { readFileSync } from "node:fs";
import { readLock, resolve, closure, identity, typesOnly } from "./lockgraph.mjs";
// TYPES_ONLY=<rootA>,<rootB>: a types-only package keys as a constant in both installs.
const roots = process.env.TYPES_ONLY?.split(",");
const id = (pk, l) => (roots && l.includes("node_modules/") && !l.startsWith("absent:") && typesOnly(roots[pk === A ? 0 : 1], l) ? `types-only:${l}` : identity(pk, l));
const [pf, la, lb] = process.argv.slice(2);
const perfile = JSON.parse(readFileSync(pf, "utf8"));
const A = readLock(la), B = readLock(lb);
const starts = (pk, pairs) => pairs.map(([from, name]) => resolve(pk, from, name) ?? `absent:${from}:${name}`);
const key = (pk, pairs, deep) => {
  const s = starts(pk, pairs);
  return [...(deep ? closure(pk, s) : new Set(s))].map((l) => id(pk, l)).sort().join("\n");
};
const result = { files: 0, envSame: {}, kept: {}, changed: {} };
for (const p of perfile.projects) {
  for (const deep of [false, true]) {
    const scheme = deep ? "graph" : "hop";
    const envSame = key(A, p.envStarts, true) === key(B, p.envStarts, true);
    result.envSame[`${p.name}:${scheme}`] = envSame;
    for (const [file, pairs] of Object.entries(p.files)) {
      const same = envSame && key(A, pairs, deep) === key(B, pairs, deep);
      (same ? (result.kept[scheme] ??= []) : (result.changed[scheme] ??= [])).push(file);
    }
  }
  result.files += Object.keys(p.files).length;
}
// Per changed file, the packages whose identity differs (graph scheme), to see what re-keys it.
if (process.env.WHY) for (const p of perfile.projects) for (const [file, pairs] of Object.entries(p.files)) {
  const a = new Set(key(A, pairs, true).split("\n")), b = new Set(key(B, pairs, true).split("\n"));
  const d = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))).map((x) => x.split("#")[0]);
  if (d.length) console.error(file, d.join(" "));
}
console.log(JSON.stringify(result));
