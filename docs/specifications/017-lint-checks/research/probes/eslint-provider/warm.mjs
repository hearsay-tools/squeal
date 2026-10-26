// Throwaway probe (017-01). 200 edits against one warm worker. After each edit
// the worker lints with its kept instance and with a new instance; both are
// compared to a fresh `eslint -f json` CLI process. Usage:
// node warm.mjs <project root> [steps]
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mutations } from "./mutations.mjs";

const root = process.argv[2];
const steps = Number(process.argv[3] ?? 200);
const FILES = ["src/a.js", "src/b.js", "src/t.ts", "src/u.ts"];
const base = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(root, f), "utf8")]));
const write = (f, text) => writeFileSync(join(root, f), text);
const resetSources = () => FILES.forEach((f) => write(f, base[f]));

// A plain edit to one source file, picked by step; some change findings in
// another file (b.js for a.js's import-x/named, u.ts for t.ts's typed rule).
function plainEdit(step) {
  const f = FILES[step % 4];
  const v = Math.floor(step / 4) % 3;
  let text = base[f];
  if (f === "src/a.js" && v === 1) text = text.replace("let y", "const y");
  if (f === "src/b.js" && v === 1) text = text.replace("export const x", "export const w");
  if (f === "src/u.ts" && v === 1) text = text.replace("export function load(): number {\n  return 1;", "export function load(): Promise<number> {\n  return Promise.resolve(1);");
  if (v === 2) text += `// step ${step}\n`;
  write(f, text);
  return `${f} v${v}`;
}

const cli = () => {
  const r = spawnSync("node", [join(root, "node_modules/eslint/bin/eslint.js"), "-f", "json", ...FILES], { cwd: root, encoding: "utf8" });
  return JSON.parse(r.stdout).map((x) => ({ file: x.filePath, messages: x.messages.map((m) => `${m.ruleId}|${m.message}`).sort() }));
};
const norm = (rs) => JSON.stringify(Object.fromEntries(rs.map((r) => [r.file.replace(root + "/", ""), r.messages])));

// Per file, what the warm result has that the CLI lacks (+) and the reverse (-).
function diff(warm, truth) {
  const w = JSON.parse(warm), t = JSON.parse(truth), out = {};
  for (const f of Object.keys(t)) {
    const plus = w[f].filter((m) => !t[f].includes(m)), minus = t[f].filter((m) => !w[f].includes(m));
    if (plus.length || minus.length) out[f] = [...plus.map((m) => "+" + m.slice(0, 60)), ...minus.map((m) => "-" + m.slice(0, 60))];
  }
  return out;
}

const rss0 = process.memoryUsage().rss;
const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { root } });
await new Promise((ok) => worker.once("message", ok));
let nextId = 0;
const ask = (files) => new Promise((ok, fail) => {
  const id = nextId++;
  const on = (m) => { if (m.id !== id) return; worker.off("message", on); m.error ? fail(new Error(m.error)) : ok(m); };
  worker.on("message", on);
  worker.postMessage({ id, files });
});

const muts = mutations(root);
const log = [];
let first, last;
for (let step = 0; step < steps; step++) {
  const k = Math.floor(step / 16), phase = step % 16;
  let what;
  if (k < muts.length && phase === 4) { resetSources(); what = "reset sources"; }
  else if (k < muts.length && phase === 5) { muts[k].apply(); what = `apply ${muts[k].id}`; }
  else if (k < muts.length && phase === 11) { muts[k].revert(); what = `revert ${muts[k].id}`; }
  else if (k < muts.length && phase > 5 && phase < 11) { write("src/t.ts", base["src/t.ts"] + `// window ${step}\n`); what = "src/t.ts comment"; }
  else what = plainEdit(step);
  const w = await ask(FILES);
  first ??= { rss: process.memoryUsage().rss, heap: w.heapUsed, loaded: w.loaded };
  // NO_CLI=1 with KEPT_ONLY=1: a memory-only run, no comparison.
  const truth = process.env.NO_CLI === "1" ? norm(w.kept) : norm(cli());
  const kept = norm(w.kept), fresh = norm(w.fresh);
  const row = { step, what, keptOk: kept === truth, freshOk: process.env.KEPT_ONLY === "1" || fresh === truth };
  if (!row.keptOk) row.keptDiff = diff(kept, truth);
  if (!row.freshOk) row.freshDiff = diff(fresh, truth);
  log.push(row);
  last = { rss: process.memoryUsage().rss, heap: w.heapUsed, instances: w.instances, version: w.version, loaded: w.loaded };
}
const open = Math.floor((steps - 1) / 16);
if (open < muts.length && (steps - 1) % 16 >= 5 && (steps - 1) % 16 < 11) muts[open].revert();
resetSources();
await worker.terminate();

const bad = log.filter((r) => !r.keptOk || !r.freshOk);
console.log(JSON.stringify({ eslint: last.version, steps, keptMismatches: log.filter((r) => !r.keptOk).length, freshMismatches: log.filter((r) => !r.freshOk).length, instances: last.instances,
  rssMB: { beforeWorker: +(rss0 / 2 ** 20).toFixed(1), afterFirstLint: +(first.rss / 2 ** 20).toFixed(1), end: +(last.rss / 2 ** 20).toFixed(1) },
  workerHeapMB: { afterFirstLint: +(first.heap / 2 ** 20).toFixed(1), end: +(last.heap / 2 ** 20).toFixed(1) } }));
console.log("config closure (project files and packages resolved before the first result):");
const pkgs = new Set();
for (const u of first.loaded) {
  if (!u.startsWith("file://" + root)) continue;
  const rel = u.slice(("file://" + root + "/").length);
  const m = rel.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) pkgs.add(m[1]); else console.log("  file", rel);
}
console.log("  packages", [...pkgs].sort().join(", "));
console.log("mismatching steps:");
for (const r of bad) console.log(JSON.stringify(r));
