// throwaway (row 018-22): resolve Vitest's per-project serializedConfig for a manual
// command line and for the options Squeal's daemon passes (src/runners/vitest/adapter.ts
// #start), then print the leaf fields that differ. Resolves config only; runs no test.
// Usage: node config-local.mjs <fixture dir with node_modules/vitest> '<vitest argv...>' ...
import { pathToFileURL } from "node:url";
const [dir, ...lines] = process.argv.slice(2);
const node = await import(pathToFileURL(`${dir}/node_modules/vitest/dist/node.js`).href);
const DROP = ["sequence.seed", "disableColors", "isAgent", "maxWorkers"]; // Squeal drops these from the key
async function resolve(options, filters = []) {
  const v = await node.createVitest("test", { root: dir, ...options }, {}, {});
  const out = {};
  for (const p of v.projects) out[p.name || "root"] = JSON.parse(JSON.stringify(p.serializedConfig, (k, x) => (x instanceof RegExp ? String(x) : x)));
  out.$root = { watch: v.config.watch, bail: v.config.bail, testNamePattern: String(v.config.testNamePattern ?? ""), filters };
  await v.close();
  return out;
}
function leaves(o, p = "", acc = {}) {
  if (o && typeof o === "object") { for (const k of Object.keys(o)) leaves(o[k], p ? `${p}.${k}` : k, acc); if (Object.keys(o).length === 0) acc[p] = Array.isArray(o) ? "[]" : "{}"; }
  else acc[p] = o;
  return acc;
}
const squeal = await resolve({ watch: false, reporters: [{}], update: "none", includeTaskLocation: true, fsModuleCache: false, coverage: { enabled: false } });
const sq = leaves(squeal);
for (const line of lines) {
  const argv = line.split(" ").filter(Boolean);
  const { filter, options } = node.parseCLI(["vitest", ...argv]);
  const run = argv[0] === "run";
  const opts = { ...options, ...(run ? { run: true, watch: false } : {}) };
  delete opts["--"]; delete opts.color;
  const got = leaves(await resolve(opts, filter));
  const diffs = [];
  for (const k of new Set([...Object.keys(sq), ...Object.keys(got)])) {
    if (DROP.some((d) => k === d || k.endsWith(`.${d}`) || k.includes(`.${d}.`))) continue;
    if (JSON.stringify(sq[k]) !== JSON.stringify(got[k])) diffs.push(`  ${k}: ${JSON.stringify(sq[k])} (squeal) -> ${JSON.stringify(got[k])}`);
  }
  console.log(`## vitest ${line}\n${diffs.join("\n") || "  (no difference)"}`);
}
process.exit(0);
