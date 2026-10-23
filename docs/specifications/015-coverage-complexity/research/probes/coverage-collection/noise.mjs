// Throwaway probe (015-01, Q6 noise): two lines.mjs records of the same sample
// at the same content. Counts (test file, source) pairs whose covered lines
// differ and functions whose hit/no-hit state differs: each would be a
// transition no edit caused. Also the fan-out: how many sample test files
// load each source.
//
// node noise.mjs <a.json> <b.json>
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
let pairs = 0;
let linesDiffer = 0;
let functions = 0;
let functionsFlip = 0;
const examples = [];
for (const [test, sources] of Object.entries(a)) {
  for (const [src, x] of Object.entries(sources)) {
    const y = b[test]?.[src];
    pairs++;
    if (!y) {
      linesDiffer++;
      examples.push(`${test} ${src}: only in first run`);
      continue;
    }
    if (x.covered.join() !== y.covered.join()) {
      linesDiffer++;
      const only = (p, q) => p.covered.filter((l) => !q.covered.includes(l));
      examples.push(`${test} ${src}: lines first-only ${only(x, y).join(",")} second-only ${only(y, x).join(",")}`);
    }
    const hits = new Map(y.functions.map(([n, l, c]) => [`${n}@${l}`, c > 0]));
    for (const [n, l, c] of x.functions) {
      functions++;
      if (hits.get(`${n}@${l}`) !== c > 0) functionsFlip++;
    }
  }
}
console.log(examples.slice(0, 15).join("\n"));
console.log(
  `NOISE pairs=${pairs} pairs-with-different-lines=${linesDiffer} functions=${functions} functions-flipped=${functionsFlip}`,
);
const fan = new Map();
for (const sources of Object.values(a)) for (const src of Object.keys(sources)) fan.set(src, (fan.get(src) ?? 0) + 1);
const counts = [...fan.values()].sort((p, q) => p - q);
const n = Object.keys(a).length;
console.log(
  `FANOUT sources=${counts.length} tests=${n} median=${counts[counts.length >> 1]} p90=${counts[Math.floor(counts.length * 0.9)]} max=${counts.at(-1)} loaded-by-all=${counts.filter((c) => c === n).length}`,
);
