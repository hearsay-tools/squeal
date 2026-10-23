// 011-149 probe (throwaway): for each real edit (path, old blob, new blob), the code each runner's transform
// emits for the two blobs, compared: Vitest's own pipeline (the project's Vite server, transformRequest, as
// Vitest's fetchModule calls it), Vite's oxc transform alone, Node's type stripping, and esbuild (tsx).
// The clone's files are overwritten with each blob in turn and restored with git at the end.
// Usage: node emit.mjs <clone> <pairs.tsv> <git dir> <out.jsonl> [vitest project names, comma-separated]
import { execFileSync } from "node:child_process";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [clone, pairsTsv, gitDir, out, only] = process.argv.slice(2);
const req = createRequire(join(clone, "package.json"));
const { createVitest } = await import(pathToFileURL(req.resolve("vitest/node")).href);
const vreq = createRequire(req.resolve("vitest/package.json")); // pnpm: vite resolves from vitest
const vite = await import(pathToFileURL(vreq.resolve("vite")).href);
let esbuild = null;
try { esbuild = req("esbuild"); } catch { /* no esbuild in this clone */ }

const blobs = new Map();
const blob = (h) => {
  if (!blobs.has(h)) blobs.set(h, execFileSync("git", ["--git-dir", gitDir, "cat-file", "blob", h]).toString("utf8"));
  return blobs.get(h);
};
const ws = (s) => s.replace(/\s+/g, " ").trim();
const mappingsOf = (m) => (m && typeof m === "object" ? m.mappings ?? null : null);

const vitest = await createVitest("test", { watch: false, reporters: [], ...(only ? { project: only.split(",") } : {}) },
  { server: { watch: null } });
const projects = new Map(vitest.projects.map((p) => [p.name, p]));
console.error("projects:", [...projects.keys()].join(" | "));

async function viaVite(project, abs, code) {
  const env = ["jsdom", "happy-dom"].includes(project.config.environment)
    ? project.vite.environments.client : project.vite.environments.ssr;
  writeFileSync(abs, code);
  for (const m of env.moduleGraph.getModulesByFile(abs) ?? []) env.moduleGraph.invalidateModule(m);
  const t0 = performance.now();
  const r = await env.transformRequest(abs);
  return { code: r?.code ?? null, mappings: mappingsOf(r?.map), ms: performance.now() - t0 };
}
async function viaOxc(project, abs, code) {
  if (!/\.(m?ts|[jt]sx|cts)$/.test(abs)) return { code, mappings: null, ms: 0 }; // Vite leaves .js to the SSR transform
  const { include, exclude, jsxInject, jsxRefreshInclude, jsxRefreshExclude, ...opts } = project.vite.config.oxc || {};
  const t0 = performance.now();
  const r = await vite.transformWithOxc(code, abs, { ...opts, sourcemap: true }, undefined, project.vite.config);
  return { code: r.code, mappings: mappingsOf(r.map), ms: performance.now() - t0 };
}
function viaStrip(abs, code) {
  if (!/\.(m?ts|cts)$/.test(abs)) return { code: null, err: "not stripped (js or tsx)" };
  try { return { code: stripTypeScriptTypes(code, { mode: "strip" }) }; } catch (e) { return { code: null, err: String(e.code || e.message).slice(0, 80) }; }
}
function viaEsbuild(abs, code) {
  if (!esbuild || !/\.(m?ts|[jt]sx|cts)$/.test(abs)) return { code: null };
  try {
    const loader = abs.endsWith("x") ? "tsx" : "ts";
    const r = esbuild.transformSync(code, { loader, sourcemap: "external", sourcefile: abs, format: "esm", target: "node22" });
    return { code: r.code, mappings: JSON.parse(r.map).mappings };
  } catch (e) { return { code: null, err: String(e.message).slice(0, 80) }; }
}
const cmp = (a, b) => {
  if (a.err || b.err || a.code === null || b.code === null) return { cls: "n/a", err: a.err || b.err || null };
  if (a.code !== b.code) return { cls: ws(a.code) === ws(b.code) ? "whitespace-only" : "differs" };
  return { cls: a.mappings === b.mappings ? "same" : "same-code-moved" };
};

writeFileSync(out, "");
const rows = readFileSync(pairsTsv, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
let i = 0;
for (const [path, oldH, newH, holders] of rows) {
  const abs = join(clone, path);
  mkdirSync(dirname(abs), { recursive: true });
  let oldCode, newCode;
  try { oldCode = blob(oldH); newCode = blob(newH); } catch { continue; }
  const rec = { path, oldH, newH, bytesEqual: oldCode === newCode, vite: {}, oxc: {} };
  const names = holders === "-" || holders === undefined ? [] : holders.split(",").filter((n) => projects.has(n));
  for (const name of names) {
    const project = projects.get(name);
    try {
      const a = await viaVite(project, abs, oldCode), b = await viaVite(project, abs, newCode);
      rec.vite[name] = { ...cmp(a, b), ms: Math.round(a.ms + b.ms) };
    } catch (e) { rec.vite[name] = { cls: "error", err: String(e.message).split("\n")[0].slice(0, 120) }; }
    try {
      const a = await viaOxc(project, abs, oldCode), b = await viaOxc(project, abs, newCode);
      rec.oxc[name] = { ...cmp(a, b), ms: +(a.ms + b.ms).toFixed(2) };
    } catch (e) { rec.oxc[name] = { cls: "error", err: String(e.message).split("\n")[0].slice(0, 120) }; }
  }
  rec.strip = cmp(viaStrip(abs, oldCode), viaStrip(abs, newCode));
  rec.esbuild = cmp(viaEsbuild(abs, oldCode), viaEsbuild(abs, newCode));
  appendFileSync(out, JSON.stringify(rec) + "\n");
  if (++i % 200 === 0) console.error(i, "of", rows.length);
}
await vitest.close();
execFileSync("git", ["-C", clone, "checkout", "--", "."]);
execFileSync("git", ["-C", clone, "clean", "-fdq"]);
console.error("done", i);
process.exit(0);
