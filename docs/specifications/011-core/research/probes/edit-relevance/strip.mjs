// Throwaway probe for research/edit-relevance.md (2026-11-07). Read only: a store copy and the
// repository's git objects (`git cat-file`); nothing is written to the repository; no test runs.
//
// For every agent edit (a `watch` revision of 1 to 3 paths): each changed TypeScript path whose old
// and new blobs are both in git is transformed, one blob at a time, by Vite 8's oxc transform
// (`transformWithOxc`, what Vitest runs on a .ts file; `onlyRemoveTypeImports` under the spec's
// `verbatim` folders) and by esbuild's `transformSync`. K1: equal code and source-map mappings;
// K2: equal code. A revision is type-only when every changed path is a TypeScript file that is K2
// equal. Its saving is the recorded seconds of the re-keyed test files that hold every changed path
// as an import only: not the test file itself, no declared input, no observed read, no child-process
// load, not the project's setup or config closure (all keep raw bytes).
// Variant keptSetup: setup and config closure paths keyed by emitted code too (raw in the main count).
// Usage: node strip.mjs <spec.json> <out.json>   (spec as order.mjs's, plus "git": the .git dir, "vite": vite's dist/node/index.js)
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { loadGraph } from "./graph.mjs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const vite = await import(spec.vite);
const esbuild = createRequire(join(spec.modules, "x.js"))("esbuild");
const g = await loadGraph(spec);
const manual = spec.manual ? new RegExp(spec.manual) : null;
const db = new DatabaseSync(spec.store, { readOnly: true });

const tests = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (manual?.test(r.path)) continue;
  tests.set(r.project + "\0" + r.path, { project: r.project, path: r.path, closure: new Set(JSON.parse(r.closure_paths)) });
}
const setup = new Map();
for (const [project, files] of Object.entries(spec.setup ?? {})) { const s = new Set(); for (const f of files) for (const x of g.depths(f).keys()) s.add(x); setup.set(project, s); }
const setupOf = (t) => setup.get(t.project) ?? setup.get("") ?? new Set();
const raw = new Map(); // project\0test -> Set of paths kept as raw bytes (observed reads, child-process loads)
for (const r of db.prepare("select key, value from meta where key like 'observed.%' or key like 'observedModules.%' or key like 'observedStartup.%'").all()) {
  const project = r.key.slice(r.key.indexOf(".") + 1);
  for (const [t, ps] of Object.entries(JSON.parse(r.value))) { const k = project + "\0" + t; const s = raw.get(k) ?? raw.set(k, new Set()).get(k); for (const p of ps) s.add(p); }
}
const holders = new Map();
for (const [id, t] of tests) for (const p of new Set([...t.closure, ...setupOf(t)])) (holders.get(p) ?? holders.set(p, []).get(p)).push(id);
const inputs = JSON.parse(readFileSync(spec.config, "utf8")).inputs ?? {};
const rules = Array.isArray(inputs) ? [{ test: "**", globs: inputs }] : Object.entries(inputs).map(([test, globs]) => ({ test, globs: [].concat(globs) }));
const declared = (t, p) => rules.some((r) => posix.matchesGlob(t.path, r.test) && r.globs.some((gl) => posix.matchesGlob(p, gl)));

const durs = new Map();
for (const d of readdirSync(spec.runs)) { const f = join(spec.runs, d, "report.json"); if (!existsSync(f)) continue;
  let r; try { r = JSON.parse(readFileSync(f, "utf8")).report; } catch { continue; }
  for (const fd of r?.fileDurations ?? []) if (fd.durationMs > 0) { const k = fd.testFile.project + "\0" + fd.testFile.path; (durs.get(k) ?? durs.set(k, []).get(k)).push(fd.durationMs / 1000); } }
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sec = (id) => (durs.has(id) ? median(durs.get(id)) : 0);

const TS = /\.(ts|tsx|mts|cts)$/;
const revs = db.prepare("select worktree_id w, number n, changes from revisions where trigger = 'watch'").all().map((r) => ({ ...r, ch: JSON.parse(r.changes) }))
  .filter((r) => r.ch.length >= 1 && r.ch.length <= 3);
// which blobs git has
const hashes = new Set(); for (const r of revs) for (const c of r.ch) { if (c.oldHash) hashes.add(c.oldHash); if (c.newHash) hashes.add(c.newHash); }
const check = spawnSync("git", ["--git-dir", spec.git, "cat-file", "--batch-check"], { input: [...hashes].join("\n") + "\n", maxBuffer: 1 << 28 }).stdout.toString();
const inGit = new Set(check.split("\n").filter((l) => / blob /.test(l)).map((l) => l.split(" ")[0]));
const blob = (h) => execFileSync("git", ["--git-dir", spec.git, "cat-file", "blob", h], { maxBuffer: 1 << 28 }).toString("utf8");
const emitted = new Map(); // hash+path -> {oxc, oxcMap, esb}
async function emit(h, path) {
  const k = h + "\0" + path; if (emitted.has(k)) return emitted.get(k);
  const text = blob(h); let v = { ok: true };
  const verbatim = (spec.verbatim ?? []).some((d) => path.startsWith(d));
  try { const r = await vite.transformWithOxc(text, "/repo/" + path, { sourcemap: true, ...(verbatim ? { typescript: { onlyRemoveTypeImports: true } } : {}) });
    v.oxc = r.code; v.map = r.map?.mappings ?? null; } catch (e) { v.ok = false; }
  try { v.esb = esbuild.transformSync(text, { loader: path.endsWith("x") ? "tsx" : "ts", format: "esm", jsx: "automatic", tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: verbatim } } }).code; } catch { v.esb = null; }
  emitted.set(k, v); return v;
}
const out = { edits: { ts: 0, dts: 0, evaluable: 0, k1: 0, k2: 0, esbEqual: 0, notTs: 0 }, revisions: [] };
for (const r of revs) {
  const paths = r.ch.map((c) => c.path);
  const R = new Set(); for (const p of paths) for (const id of holders.get(p) ?? []) R.add(id);
  for (const [id, t] of tests) if (paths.includes(t.path)) R.add(id);
  let cls = "typeOnly"; const per = [];
  for (const c of r.ch) {
    if (c.path.endsWith(".d.ts")) { out.edits.dts++; per.push("dts"); cls = cls === "typeOnly" ? "dts" : cls; continue; }
    if (!TS.test(c.path)) { out.edits.notTs++; per.push("notTs"); cls = "runtime"; continue; }
    out.edits.ts++;
    if (!c.oldHash || !c.newHash || !inGit.has(c.oldHash) || !inGit.has(c.newHash)) { per.push("unevaluable"); if (cls !== "runtime") cls = "unevaluable"; continue; }
    const a = await emit(c.oldHash, c.path), b = await emit(c.newHash, c.path);
    if (!a.ok || !b.ok) { per.push("unevaluable"); if (cls !== "runtime") cls = "unevaluable"; continue; }
    out.edits.evaluable++;
    const k2 = a.oxc === b.oxc, k1 = k2 && a.map === b.map;
    if (k2) out.edits.k2++; if (k1) out.edits.k1++; if (a.esb !== null && a.esb === b.esb) out.edits.esbEqual++;
    per.push(k1 ? "k1" : k2 ? "k2" : "runtime"); if (!k2) cls = "runtime";
  }
  let rekeyed = 0, kept = 0, keptK1 = 0, keptFiles = 0, keptSetup = 0;
  const allK1 = per.every((x) => x === "k1");
  for (const id of R) {
    const t = tests.get(id); const s = sec(id); rekeyed += s;
    const importOnly = paths.every((p) => !t.closure.has(p) && !setupOf(t).has(p) ? true :
      p !== t.path && t.closure.has(p) && !setupOf(t).has(p) && !declared(t, p) && !(raw.get(id)?.has(p)));
    if (cls === "typeOnly" && importOnly) { kept += s; keptFiles++; if (allK1) keptK1 += s; }
    // variant: the setup and config closure is keyed by emitted code too (Vitest transforms it as well)
    const importOrSetup = paths.every((p) => !t.closure.has(p) && !setupOf(t).has(p) ? true :
      p !== t.path && !declared(t, p) && !(raw.get(id)?.has(p)));
    if (cls === "typeOnly" && importOrSetup) keptSetup += s;
  }
  out.revisions.push({ w: r.w, n: r.n, paths, cls, per, files: R.size, rekeyed: +rekeyed.toFixed(1), kept: +kept.toFixed(1), keptK1: +keptK1.toFixed(1), keptSetup: +keptSetup.toFixed(1), keptFiles });
}
const sum = (f) => out.revisions.reduce((a, r) => a + f(r), 0);
const byCls = {}; for (const r of out.revisions) { const b = byCls[r.cls] ?? (byCls[r.cls] = { revisions: 0, rekeyed: 0, kept: 0 }); b.revisions++; b.rekeyed += r.rekeyed; b.kept += r.kept; }
for (const b of Object.values(byCls)) { b.rekeyed = Math.round(b.rekeyed); b.kept = Math.round(b.kept); }
const total = sum((r) => r.rekeyed), kept = sum((r) => r.kept), keptK1 = sum((r) => r.keptK1), keptSetup = sum((r) => r.keptSetup);
const evalRevs = out.revisions.filter((r) => r.cls === "typeOnly" || r.cls === "runtime" || r.cls === "dts");
const evalTotal = evalRevs.reduce((a, r) => a + r.rekeyed, 0);
const tsRevs = out.revisions.filter((r) => r.per.some((x) => x !== "notTs"));
out.summary = { agentRevisions: out.revisions.length, tsRevisions: tsRevs.length, edits: out.edits, byCls,
  rekeyedSec: Math.round(total), keptSec: Math.round(kept), keptShare: +(100 * kept / total).toFixed(2), keptK1Share: +(100 * keptK1 / total).toFixed(2), keptSetupSec: Math.round(keptSetup), keptSetupShare: +(100 * keptSetup / total).toFixed(2), keptSetupShareOfEvaluable: +(100 * keptSetup / evalTotal).toFixed(2),
  keptShareOfEvaluable: +(100 * kept / evalTotal).toFixed(2), typeOnlyRekeyedSec: Math.round(byCls.typeOnly?.rekeyed ?? 0),
  typeOnlyKeptShareOfTheirRekeyed: +(100 * kept / (byCls.typeOnly?.rekeyed || 1)).toFixed(1) };
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(JSON.stringify(out.summary, null, 1));
