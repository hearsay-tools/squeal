// Throwaway probe (row 025-14). Compares the stdout (and stderr) of every
// run of a variant with the base build's, each from its own fresh seeded store
// (hook-runs.probe.ts PROBE_STDOUT). Numbers such as times and ids are masked.
// Usage: node parity.mjs <out-base.json> <out-variant.json>...
import { readFileSync } from "node:fs";

const mask = (s) => s.replace(/\d+/g, "N");
const [basePath, ...others] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, "utf8"));
for (const path of others) {
  const v = JSON.parse(readFileSync(path, "utf8"));
  let same = 0, diff = 0;
  for (const [k, outs] of Object.entries(base)) {
    const name = k.split("@")[0];
    const vk = Object.keys(v).find((x) => x.split("@")[0] === name);
    outs.forEach((o, i) => {
      if (mask(o) === mask(v[vk]?.[i] ?? "<missing>")) same++;
      else { diff++; console.log(`  differs: ${name} run ${i}\n    base: ${o.slice(0, 200)}\n    vari: ${(v[vk]?.[i] ?? "<missing>").slice(0, 200)}`); }
    });
  }
  console.log(`${path}: ${same} same, ${diff} differ`);
}
