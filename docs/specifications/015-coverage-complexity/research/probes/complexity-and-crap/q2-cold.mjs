// Throwaway probe (015-02), Q2: cold cost in a fresh process (init, grammar load, first parse), and
// whether the TSX grammar alone counts .ts files as the TypeScript grammar does.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
const DEPS = process.env.DEPS ?? "/tmp/r01502/js/";
const require = createRequire(DEPS);
const mode = process.argv[2];
const file = process.argv[3];
const t0 = performance.now();
if (mode === "treesitter") {
  const { Parser, Language } = require("web-tree-sitter");
  await Parser.init();
  const t1 = performance.now();
  const lang = await Language.load(`${DEPS}node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`);
  const t2 = performance.now();
  const p = new Parser(); p.setLanguage(lang); p.parse(readFileSync(file, "utf8"));
  const t3 = performance.now();
  console.log(JSON.stringify({ mode, initMs: +(t1 - t0).toFixed(1), grammarMs: +(t2 - t1).toFixed(1), firstParseMs: +(t3 - t2).toFixed(1) }));
} else if (mode === "oxc") {
  const oxc = require("oxc-parser"); const t1 = performance.now();
  oxc.parseSync(file, readFileSync(file, "utf8"));
  console.log(JSON.stringify({ mode, loadMs: +(t1 - t0).toFixed(1), firstParseMs: +(performance.now() - t1).toFixed(1) }));
} else if (mode === "acorn") {
  const acorn = require("acorn"); const { stripTypeScriptTypes } = await import("node:module"); const t1 = performance.now();
  acorn.parse(stripTypeScriptTypes(readFileSync(file, "utf8")), { ecmaVersion: "latest", sourceType: "module" });
  console.log(JSON.stringify({ mode, loadMs: +(t1 - t0).toFixed(1), firstParseMs: +(performance.now() - t1).toFixed(1) }));
} else if (mode === "tsx-for-ts") {
  const { countFunctions } = await import("./cc-treesitter.mjs");
  const { Parser, Language } = require("web-tree-sitter");
  await Parser.init();
  const ts = new Parser(); ts.setLanguage(await Language.load(`${DEPS}node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`));
  const tsx = new Parser(); tsx.setLanguage(await Language.load(`${DEPS}node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm`));
  const files = []; (function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|mjs|cjs|js)$/.test(e)) files.push(p); } })(file);
  let same = 0; const diff = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    const a = JSON.stringify(countFunctions(ts.parse(s), "ts")), b = JSON.stringify(countFunctions(tsx.parse(s), "ts"));
    if (a === b) same++; else diff.push(f);
  }
  console.log(JSON.stringify({ mode, files: files.length, same, diff: diff.slice(0, 5) }));
}
