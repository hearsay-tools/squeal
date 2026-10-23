// Throwaway probe (015-02). Loads every engine from a scratch install (DEPS, default /tmp/r01502/js).
import { createRequire, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { countFunctions as tsCount } from "./cc-treesitter.mjs";
import { countFunctions as esCount, lineIndex } from "./cc-estree.mjs";

const DEPS = process.env.DEPS ?? "/tmp/r01502/js/";
export const require = createRequire(DEPS);
const { Parser, Language } = require("web-tree-sitter");
const acorn = require("acorn");
const oxc = require("oxc-parser");

await Parser.init();
const grammarDir = `${DEPS}node_modules/`;
export const grammars = {
  typescript: await Language.load(`${grammarDir}tree-sitter-typescript/tree-sitter-typescript.wasm`),
  tsx: await Language.load(`${grammarDir}tree-sitter-typescript/tree-sitter-tsx.wasm`),
  javascript: await Language.load(`${grammarDir}tree-sitter-javascript/tree-sitter-javascript.wasm`),
  python: await Language.load(process.env.PY_GRAMMAR ?? new URL("../../../../../../src/runners/pytest/graph/tree-sitter-python.wasm", import.meta.url).pathname),
};
const parsers = Object.fromEntries(Object.entries(grammars).map(([k, l]) => { const p = new Parser(); p.setLanguage(l); return [k, p]; }));

export function langOf(path) {
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.[cm]?ts$/.test(path)) return "typescript";
  if (path.endsWith(".py")) return "python";
  return "javascript";
}

export function viaTreeSitter(path, source = readFileSync(path, "utf8")) {
  const lang = langOf(path);
  const tree = parsers[lang].parse(source);
  const fns = tsCount(tree, lang === "python" ? "python" : "ts");
  const hasError = tree.rootNode.hasError;
  tree.delete();
  return { fns, hasError };
}

export function viaAcorn(path, source = readFileSync(path, "utf8")) {
  const js = langOf(path) === "javascript" ? source : stripTypeScriptTypes(source, { mode: "strip" });
  const program = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  return { fns: esCount(program, lineIndex(js)) };
}

export function viaOxc(path, source = readFileSync(path, "utf8")) {
  const r = oxc.parseSync(path, source);
  return { fns: esCount(r.program, lineIndex(source)), errors: r.errors.length };
}

export function viaEslint(path, source = readFileSync(path, "utf8")) {
  const { Linter } = require("eslint");
  const js = langOf(path) === "javascript" ? source : stripTypeScriptTypes(source, { mode: "strip" });
  const msgs = new Linter({ configType: "flat" }).verify(js, [
    { languageOptions: { ecmaVersion: "latest", sourceType: "module" }, rules: { complexity: ["error", 0] } },
  ]);
  return {
    fns: msgs.filter((m) => m.ruleId === "complexity").map((m) => ({
      name: /^(.*) has a complexity/.exec(m.message)[1], line: m.line, col: m.column - 1,
      cc: Number(/complexity of (\d+)/.exec(m.message)[1]),
    })),
    fatal: msgs.filter((m) => m.fatal).map((m) => m.message),
  };
}

export function viaEscomplex(path, source = readFileSync(path, "utf8")) {
  const escomplex = require("typhonjs-escomplex").default ?? require("typhonjs-escomplex");
  const js = langOf(path) === "javascript" ? source : stripTypeScriptTypes(source, { mode: "strip" });
  const r = escomplex.analyzeModule(js);
  return { fns: [...r.methods, ...r.classes.flatMap((c) => c.methods)].map((m) => ({ name: m.name, line: m.lineStart, cc: m.cyclomatic })) };
}
