// Throwaway (007-04): candidates per test-file closure under D4's rule against the symmetric rule.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [root, a, b] = process.argv.slice(2);
const med = (f) => {
  const r = JSON.parse(execFileSync("node", [new URL("./closure_sizes.mjs", import.meta.url).pathname, root, f]));
  const xs = r.map((x) => x.cands).sort((p, q) => p - q);
  return { median: xs[xs.length >> 1], max: xs[xs.length - 1], files_median: r.map((x) => x.files).sort((p, q) => p - q)[r.length >> 1] };
};
console.log(JSON.stringify({ d4: med(a), sym: med(b) }));
