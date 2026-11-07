// Throwaway probe for research/edit-relevance.md (2026-11-07). Read only.
// The static value-import graph of a checkout, as 015's probes/edit-reach/reach.mjs emulates it:
// esbuild's TS transform drops imports used only as types (as Vite's transform does), es-module-lexer
// reads the imports, relative, alias and workspace-package specifiers resolve; packages leave the graph.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";

export async function loadGraph(spec) {
  const req = createRequire(join(spec.modules, "x.js"));
  const esbuild = req("esbuild");
  const lexer = req("es-module-lexer");
  await (typeof lexer.init === "function" ? lexer.init() : lexer.init);
  const repo = spec.repo;
  const tracked = execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
  const trackedSet = new Set(tracked);
  const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const pkgs = [];
  for (const f of tracked) {
    if (!/(^|\/)package\.json$/.test(f) || f.includes("node_modules") || f.includes("fixtures")) continue;
    try { const p = JSON.parse(readFileSync(join(repo, f), "utf8")); if (p.name) pkgs.push({ name: p.name, dir: dirname(f) === "." ? "" : dirname(f), exports: p.exports }); } catch {}
  }
  const isFile = (p) => trackedSet.has(p) || (existsSync(join(repo, p)) && statSync(join(repo, p)).isFile());
  const candidates = (base) => {
    const c = [base];
    if (/\.(js|jsx)$/.test(base)) c.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base.replace(/\.jsx$/, ".tsx"));
    if (/\.mjs$/.test(base)) c.push(base.replace(/\.mjs$/, ".mts"));
    if (/\.cjs$/.test(base)) c.push(base.replace(/\.cjs$/, ".cts"));
    for (const e of [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json"]) c.push(base + e);
    for (const e of ["/index.ts", "/index.tsx", "/index.js", "/index.mjs"]) c.push(base + e);
    return c;
  };
  const firstFile = (base) => candidates(base).find(isFile) ?? null;
  function resolveSpec(from, s) {
    s = s.split("?")[0];
    if (s.startsWith(".")) return firstFile(posix.normalize(posix.join(posix.dirname(from), s)));
    for (const [a, rep] of Object.entries(spec.aliases ?? {})) if (s.startsWith(a)) return firstFile(rep + s.slice(a.length));
    for (const p of pkgs) {
      if (s !== p.name && !s.startsWith(p.name + "/")) continue;
      const sub = s === p.name ? "." : "./" + s.slice(p.name.length + 1);
      let target = null; const ex = p.exports;
      if (typeof ex === "string" && sub === ".") target = ex;
      else if (ex && typeof ex === "object") {
        if (sub in ex) target = ex[sub];
        else for (const [k, v] of Object.entries(ex)) if (k.endsWith("/*") && sub.startsWith(k.slice(0, -1)) && typeof v === "string") { target = v.replace("*", sub.slice(k.length - 1)); break; }
        if (target && typeof target === "object") target = target.import ?? target.default ?? target.types ?? null;
      }
      if (!target && sub === ".") target = "./src/index.ts";
      if (!target) return null;
      const base = posix.normalize(posix.join(p.dir, target));
      return firstFile(base) ?? firstFile(base.replace(/\/dist\//, "/src/").replace(/\.js$/, ".ts"));
    }
    return null;
  }
  const nodes = new Map();
  function parse(path) {
    if (nodes.has(path)) return nodes.get(path);
    const n = { value: new Set(), barrel: false };
    nodes.set(path, n);
    if (!CODE.test(path) || path.endsWith(".d.ts")) return n;
    let text; try { text = readFileSync(join(repo, path), "utf8"); } catch { return n; }
    let code = text;
    if (/\.(ts|tsx|mts|cts|jsx)$/.test(path)) {
      const verbatim = (spec.verbatim ?? []).some((d) => path.startsWith(d));
      try { code = esbuild.transformSync(text, { loader: path.endsWith("x") ? "tsx" : "ts", format: "esm", jsx: "automatic", tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: verbatim } } }).code; } catch { return n; }
    }
    let imports = [];
    try { [imports] = lexer.parse(code); } catch { imports = []; }
    // two lexer shapes: es-module-lexer (n, ss, se, d) and the newer one (specifier, importStart, importEnd, type)
    imports = imports.map((im) => ({ n: im.n ?? im.specifier, ss: im.ss ?? im.importStart ?? -1, se: im.se ?? im.importEnd,
      d: im.d ?? (im.type === "dynamic" || im.type === "import.meta" ? 0 : -1) }));
    let rest = code;
    for (const im of [...imports].sort((a, b) => b.ss - a.ss)) {
      if (im.n) { const r = resolveSpec(path, im.n); if (r) n.value.add(r); }
      if (im.ss >= 0 && im.d === -1) rest = rest.slice(0, im.ss) + rest.slice(im.se);
    }
    for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) { const r = resolveSpec(path, m[1]); if (r) n.value.add(r); }
    rest = rest.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/export\s*\{[^}]*\}\s*;?/g, "").replace(/[\s;]/g, "");
    n.barrel = rest === "" && /export\s*(\*|\{)/.test(code) && n.value.size > 0;
    return n;
  }
  for (const f of tracked) if (CODE.test(f)) parse(f);
  // shortest value-import depth from `start` to every module; `through(m)` false stops at m
  function depths(start, through = () => true) {
    const d = new Map([[start, 0]]); let frontier = [start];
    while (frontier.length) {
      const next = [];
      for (const m of frontier) {
        if (m !== start && !through(m)) continue;
        for (const x of parse(m).value) if (!d.has(x)) { d.set(x, d.get(m) + 1); next.push(x); }
      }
      frontier = next;
    }
    return d;
  }
  return { tracked, trackedSet, parse, depths };
}
