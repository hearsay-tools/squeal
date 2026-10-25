// Throwaway (016-19). Q4 with Q2: per bound, what run 1 keeps, what run 2 keeps, and what
// run 2 adds that run 1 lacked (the growth of `#extra` under that bound), plus the
// combination "not under a directory the test wrote and no random segment".
// Usage: node bounds-growth.mjs <run1/result.json> <run2/result.json>
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const sets = (r) => {
  const s = Object.fromEntries(Object.entries(r.bounds).map(([k, v]) => [k, new Set(v.all)]));
  s.none = new Set(r.files);
  s.notWrittenNorRandom = new Set([...s.notUnderWrittenDir].filter((p) => s.noRandomSegment.has(p)));
  return s;
};
const s1 = sets(a), s2 = sets(b);
const out = {};
for (const k of Object.keys(s1)) out[k] = { run1: s1[k].size, run2: s2[k].size, newInRun2: [...s2[k]].filter((p) => !s1[k].has(p)).length };
out.notWrittenNorRandomPaths = [...s1.notWrittenNorRandom];
console.log(JSON.stringify(out, null, 1));
