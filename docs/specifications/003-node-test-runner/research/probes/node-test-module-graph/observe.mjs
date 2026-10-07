// THROWAWAY probe. Observed closure per test file: run node --test with the recorder, rebuild
// reachability from each test file URL over the recorded (parent -> resolved) edges.
// usage: node observe.mjs <fixtureRoot> <out.json> [--isolation=none] [--recorder=sync|async] [--recorder-first]
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const [root, out, ...flags] = process.argv.slice(2);
const iso = flags.find((f) => f.startsWith("--isolation="));
const kind = (flags.find((f) => f.startsWith("--recorder=")) ?? "--recorder=sync").split("=")[1];
const recorder = fileURLToPath(new URL(`./recorder-${kind}.mjs`, import.meta.url));
const pkg = join(root, "packages/core");
const files = readdirSync(join(pkg, "test/unit")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/unit/${f}`);
const rec = `/tmp/ntmg-rec-${process.pid}`; rmSync(rec, { recursive: true, force: true });
const imports = ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx", "--import", recorder];
if (flags.includes("--recorder-first")) imports.unshift(...imports.splice(4, 2));
const args = [...imports, "--test", ...(iso ? [`--${process.versions.node.startsWith("22.") ? "experimental-" : ""}test-isolation=${iso.split("=")[1]}`] : []), "--test-reporter=dot", ...files];
const t0 = performance.now();
try { execFileSync(process.execPath, args, { cwd: pkg, env: { ...process.env, RECORD_DIR: rec }, stdio: ["ignore", "pipe", "pipe"] }); }
catch (e) { console.error("node --test exited", e.status, String(e.stdout).slice(-400), String(e.stderr).slice(-800)); }
const wall = performance.now() - t0;
const realRoot = realpathSync(root);
const project = (u) => u.startsWith("file:") && !u.includes("/node_modules/") && fileURLToPath(u).startsWith(realRoot + "/");
const result = {};
const procs = readdirSync(rec).map((f) => JSON.parse(readFileSync(join(rec, f), "utf8")));
for (const p of procs) {
  const adj = new Map();
  for (const [parent, , url] of p.edges) { if (!parent) continue; if (!adj.has(parent)) adj.set(parent, new Set()); adj.get(parent).add(url); }
  const loaded = new Set(p.loaded);
  for (const f of files) {
    const root0 = new URL(`file://${realpathSync(join(pkg, f))}`).href;
    if (!loaded.has(root0)) continue;
    const seen = new Set([root0]), st = [root0];
    while (st.length) for (const d of adj.get(st.pop()) ?? []) if (!seen.has(d)) { seen.add(d); st.push(d); }
    result[relative(realRoot, fileURLToPath(root0))] = [...seen].filter(project).map((u) => relative(realRoot, fileURLToPath(u))).sort();
  }
  // preload closure: reachable from the preload, not from any test file
  const pre = new URL(`file://${realpathSync(join(root, "scripts/test-git-env.mjs"))}`).href;
  const ps = new Set([pre]), st = [pre];
  while (st.length) for (const d of adj.get(st.pop()) ?? []) if (!ps.has(d)) { ps.add(d); st.push(d); }
  result.__preload = [...ps].filter(project).map((u) => relative(realRoot, fileURLToPath(u))).sort();
}
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ node: process.version, isolation: iso ?? "process", recorder: kind, processes: procs.length, testFiles: Object.keys(result).length - 1, wallMs: Math.round(wall) }));
