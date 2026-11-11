// Throwaway probe (row 020-17). Re-runs cezar-store.mjs's list-scheduling
// simulation from its saved output, with no store read. The e2e files run
// one at a time after every other file, as Vitest groups them.
// Usage: node simulate.mjs <cezar-store.json> <W> <store|manifest>
// Cost per file: store = the store's file-check duration, else manifest, else
// the median of those; manifest = the manifest, else the store's, else median.
import { readFileSync } from "node:fs";

const [path, wArg, cost] = process.argv.slice(2);
const W = Number(wArg);
const { changed, files: raw } = JSON.parse(readFileSync(path, "utf8"));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pick = (f) => (cost === "store" ? f.storedFileMs ?? f.manifestMs : f.manifestMs ?? f.storedFileMs);
const fallback = median(raw.map(pick).filter((x) => x != null));
const files = raw.map((f) => ({ ...f, ms: pick(f) ?? fallback, est: pick(f) == null }));
const tests = (f) => f.project !== "e2e";
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
function simulate(order, T, scope) {
  const run = order.filter((f) => scope === "all" || tests(f));
  // Vitest 4.1.10 groupSpecs: an isolated project with maxWorkers 1 (e2e's
  // fileParallelism: false) goes to a sequential group that runs after the rest.
  const lanes = Array(W).fill(0); const end = new Map();
  for (const f of run) {
    if (!tests(f)) continue;
    let i = 0; for (let k = 1; k < W; k++) if (lanes[k] < lanes[i]) i = k;
    lanes[i] += f.ms; end.set(f, lanes[i]);
  }
  let e2e = Math.max(...lanes);
  for (const f of run) if (!tests(f)) { e2e += f.ms; end.set(f, e2e); }
  const paths = changed.filter((p) => { const l = run.filter((f) => f.loads.includes(p)); return l.length > 0 && l.every((f) => end.get(f) <= T * 1000); });
  return { files: run.length, done: [...end.values()].filter((t) => t <= T * 1000).length, paths, makespanS: Math.round(Math.max(...lanes, e2e) / 1000) };
}
const byPath = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.project < b.project ? -1 : 1));
const size = Object.fromEntries(changed.map((p) => [p, files.filter((f) => f.loads.includes(p)).length]));
const rank = (f) => Math.min(...f.loads.map((p) => size[p]));
const byLoaders = [...byPath].sort((a, b) => rank(a) - rank(b));
const out = { W, cost, files: files.length, estimatedCost: files.filter((f) => f.est).length, fallbackMs: Math.round(fallback),
  serialS: { all: Math.round(sum(files.map((f) => f.ms)) / 1000), tests: Math.round(sum(files.filter(tests).map((f) => f.ms)) / 1000), browser: Math.round(sum(files.filter((f) => !tests(f)).map((f) => f.ms)) / 1000) },
  sims: {} };
for (const T of [600, 1500]) for (const scope of ["all", "tests"]) for (const [name, order] of [["path", byPath], ["loaders", byLoaders]]) {
  const r = simulate(order, T, scope);
  out.sims[`${T}s ${scope} ${name}`] = `${r.done}/${r.files} files, ${r.paths.length} paths complete (${r.paths.map((p) => p.split("/").pop()).join(", ")}), makespan ${r.makespanS}s`;
}
console.log(JSON.stringify(out, null, 1));
