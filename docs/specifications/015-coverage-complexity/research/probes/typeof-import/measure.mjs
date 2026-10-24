// Throwaway probe (015-25). Counts every JS/TS file of a repository several ways and compares each with ESLint:
//   shipped  the counter as on main (tree-sitter-tsx 0.23.2, NUL read as a space)
//   r1, r2, r3  the same walk over the same grammar, the parse input rewritten first (REWRITES below); the walk
//            gets the file's own text, as `withCodeTree` does for NUL
//   pr375    the same walk over tree-sitter-tsx built from tree-sitter-typescript pull request 375
// Run from the worktree root: node_modules/.bin/tsx <this> <repo> <out.json>
// Env: WASM375 (the PR's grammar), WASM0232 (0.23.2 built here), ESLINT_DEPS (a scratch install of eslint@10.13.0 and @typescript-eslint/parser).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const { counterReady, countFile } = await import(`${ROOT}src/core/code/count/index.ts`);
const { countTree } = await import(`${ROOT}src/core/code/count/walk.ts`);
const { TYPESCRIPT_RULES } = await import(`${ROOT}src/core/code/count/typescript.ts`);
const { Language, Parser } = await import(`${ROOT}node_modules/web-tree-sitter/web-tree-sitter.js`);
const deps = createRequire(`${process.env.ESLINT_DEPS ?? "/tmp/tir-015-25/js"}/package.json`);
const { Linter } = deps("eslint");
const tsParser = deps("@typescript-eslint/parser");

await counterReady(); // initialises web-tree-sitter once; the parsers below share its runtime
const parserFor = async (wasm) => {
  const p = new Parser();
  p.setLanguage(await Language.load(readFileSync(wasm)));
  return p;
};
const shippedParser = await parserFor(`${ROOT}src/core/code/count/tree-sitter-tsx.wasm`);
const pr375Parser = await parserFor(process.env.WASM375 ?? "/tmp/tir-015-25/g-pr375.wasm");
// Control: 0.23.2 built with the same toolchain as the PR's grammar (WASM0232), against the shipped file.
const own0232Parser = await parserFor(process.env.WASM0232 ?? "/tmp/tir-015-25/g-0232.wasm");

// Each keeps every UTF-16 offset and every line break, so every range the walk reads stays.
const LITERAL = String.raw`import[ \t]*\([ \t]*(?:'[^'\n\\$\x60]*'|"[^"\n\\$\x60]*")[ \t]*\)`;
const blank = (m) => "_".repeat(m.length);
export const REWRITES = {
  // r1: the `i` of `typeof import(` becomes `_`: a type query of a call of an identifier.
  r1: (text) => text.replace(/\btypeof(\s+)import(\s*\()/g, "typeof$1_mport$2"),
  // r2: `import("x")` after `typeof `, `<` or `,` becomes one identifier of underscores.
  r2: (text) => text.replace(new RegExp(String.raw`(?<=\btypeof\s+|[<,]\s*)` + LITERAL, "g"), blank),
  // r3: every `import("x")` with a plain string literal becomes one identifier of underscores.
  r3: (text) => text.replace(new RegExp(String.raw`\b` + LITERAL, "g"), blank),
};
const VARIANTS = Object.keys(REWRITES);

const root = process.argv[2];
const isTest = (p) => /\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(p);
const files = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p))
  .filter((p) => !p.startsWith("docs/") && !p.includes("fixtures/") && !/(^|\/)(dist|build|vendor)\//.test(p))
  .filter((p) => !p.endsWith(".min.js"));

const before = (l, c, L, C) => l < L || (l === L && c < C);
const overlaps = (a, b) =>
  b.startLine === b.endLine && b.startColumn === b.endColumn
    ? before(a.startLine, a.startColumn, b.startLine, b.startColumn) &&
      !before(a.endLine, a.endColumn, b.startLine, b.startColumn)
    : before(a.startLine, a.startColumn, b.endLine, b.endColumn) &&
      before(b.startLine, b.startColumn, a.endLine, a.endColumn);

function countWith(parser, input, text) {
  const tree = parser.parse(input);
  try {
    return { ...countTree(tree.rootNode, text, TYPESCRIPT_RULES), sexp: tree.rootNode.toString() };
  } finally {
    tree.delete();
  }
}

/** Where each `import` a rewrite changed sits in the shipped tree: code, or inside a string, comment or template. */
function rewriteSites(before, after) {
  const tree = shippedParser.parse(before);
  const kinds = [];
  for (let at = before.indexOf("import"); at >= 0; at = before.indexOf("import", at + 1)) {
    if (after.startsWith("import", at)) continue;
    let n = tree.rootNode.descendantForIndex(at);
    let kind = "code";
    for (; n; n = n.parent) {
      if (["string", "comment", "template_string", "regex", "jsx_text"].includes(n.type)) {
        kind = n.type;
        break;
      }
      if (n.type === "template_substitution") break;
    }
    kinds.push(kind);
  }
  tree.delete();
  return kinds;
}

function eslint(path, text) {
  const jsx = /\.(tsx|jsx)$/.test(path) || /\.[cm]?js$/.test(path);
  const msgs = new Linter({ configType: "flat" }).verify(
    text,
    [
      {
        files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
        languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx } }, sourceType: "module" },
        rules: { complexity: ["error", 0] },
      },
    ],
    { filename: path },
  );
  return {
    ccs: msgs
      .filter((m) => m.ruleId === "complexity" && !/class field initializer|class static block/i.test(m.message))
      .map((m) => Number(/complexity of (\d+)/.exec(m.message)[1])),
    // A disable comment for a rule not loaded here is reported too; only a parse failure counts.
    fatal: msgs.find((m) => m.fatal)?.message ?? null,
  };
}

const multiset = (ccs) => JSON.stringify([...ccs].sort((a, b) => a - b));
const out = [];
const timing = { parseMs: 0, ...Object.fromEntries(VARIANTS.map((v) => [`${v}Ms`, 0])) };
for (const path of files) {
  let text;
  try {
    text = readFileSync(`${root}/${path}`, "utf8");
  } catch {
    continue;
  }
  if (Buffer.byteLength(text) > 524288) continue;
  const lang = /\.[cm]?jsx?$/.test(path) ? "javascript" : "typescript";
  const base = text.replaceAll("\0", " ");
  const has = /\btypeof\s+import\s*\(/.test(base);
  const inputs = {};
  for (const v of VARIANTS) {
    const t = performance.now();
    inputs[v] = REWRITES[v](base);
    timing[`${v}Ms`] += performance.now() - t;
  }
  const t = performance.now();
  const shipped = await countFile(text, lang);
  timing.parseMs += performance.now() - t;
  const shippedTree = countWith(shippedParser, base, text);
  const variants = {};
  for (const v of VARIANTS) {
    variants[v] = inputs[v] === base ? shippedTree : countWith(shippedParser, inputs[v], text);
  }
  const pr375 = countWith(pr375Parser, base, text);
  const own0232 = countWith(own0232Parser, base, text);
  const es = eslint(path, text);
  const summary = (c) => {
    const lost = c.functions.filter((f) => c.errors.some((e) => overlaps(f.range, e)));
    return {
      errors: c.errors.length,
      functions: c.functions.length,
      inError: lost.length,
      ccs: multiset(c.functions.map((f) => f.complexity)),
      ids: c.functions.map((f) => `${f.qualifiedName}#${f.occurrence}=${f.complexity}@${f.range.startLine}`),
    };
  };
  out.push({
    path,
    test: isTest(path),
    has,
    changed: Object.fromEntries(VARIANTS.map((v) => [v, inputs[v] !== base])),
    sites: Object.fromEntries(VARIANTS.map((v) => [v, inputs[v] === base ? [] : rewriteSites(base, inputs[v])])),
    shipped: summary(shipped),
    ...Object.fromEntries(VARIANTS.map((v) => [v, summary(variants[v])])),
    pr375: summary(pr375),
    pr375TreeSame: pr375.sexp === shippedTree.sexp,
    own0232TreeSame: own0232.sexp === shippedTree.sexp,
    eslint: { ccs: multiset(es.ccs), functions: es.ccs.length, fatal: es.fatal },
  });
}
timing.files = out.length;
timing.load1 = loadavg()[0];
writeFileSync(process.argv[3], JSON.stringify({ root, timing, files: out }));
console.log(JSON.stringify(timing));
