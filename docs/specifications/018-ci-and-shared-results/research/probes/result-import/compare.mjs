// Throwaway (topic result-import): which test file keys match between two dumps.
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8")));
const byPath = (d) => new Map(d.keys.map((k) => [k.path, k.key]));
const ka = byPath(a), kb = byPath(b);
for (const path of [...new Set([...ka.keys(), ...kb.keys()])].sort()) {
  const x = ka.get(path), y = kb.get(path);
  console.log(`${x && x === y ? "MATCH " : "DIFFER"} ${path} ${x?.slice(0, 12)} ${y?.slice(0, 12)}`);
}
