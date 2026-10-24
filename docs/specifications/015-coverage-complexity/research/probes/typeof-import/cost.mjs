// Throwaway probe (015-25). Cost of rewrite r2 per file: the counter's parse and walk of every JS/TS file
// without it (off) and with it (on), alternated, five pairs, load recorded beside each.
// Run from the worktree root: node_modules/.bin/tsx <this> <repo>...
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const { counterReady } = await import(`${ROOT}src/core/code/count/index.ts`);
const { countTree } = await import(`${ROOT}src/core/code/count/walk.ts`);
const { TYPESCRIPT_RULES } = await import(`${ROOT}src/core/code/count/typescript.ts`);
const { Language, Parser } = await import(`${ROOT}node_modules/web-tree-sitter/web-tree-sitter.js`);
await counterReady();
const parser = new Parser();
parser.setLanguage(await Language.load(readFileSync(`${ROOT}src/core/code/count/tree-sitter-tsx.wasm`)));

const LITERAL = String.raw`import[ \t]*\([ \t]*(?:'[^'\n\\$\x60]*'|"[^"\n\\$\x60]*")[ \t]*\)`;
const R2 = new RegExp(String.raw`(?<=\btypeof\s+|[<,]\s*)` + LITERAL, "g");
const r2 = (text) => (text.includes("import") ? text.replace(R2, (m) => "_".repeat(m.length)) : text);

const texts = process.argv.slice(2).flatMap((root) =>
  execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p) && !p.startsWith("docs/") && !p.includes("fixtures/"))
    .map((p) => { try { return readFileSync(`${root}/${p}`, "utf8"); } catch { return null; } })
    .filter((t) => t !== null && Buffer.byteLength(t) <= 524288),
);
const count = (input, text) => {
  const tree = parser.parse(input);
  try { return countTree(tree.rootNode, text, TYPESCRIPT_RULES).functions.length; } finally { tree.delete(); }
};
const round = (on) => {
  const t = performance.now();
  let rewriteMs = 0;
  for (const text of texts) {
    const base = text.replaceAll("\0", " ");
    let input = base;
    if (on) { const r = performance.now(); input = r2(base); rewriteMs += performance.now() - r; }
    count(input, text);
  }
  return { ms: performance.now() - t, rewriteMs };
};
round(false); round(true); // warm-up
const pairs = [];
for (let i = 0; i < 5; i++) {
  const off = round(false), load1 = loadavg()[0], on = round(true);
  pairs.push({ offMs: +off.ms.toFixed(0), onMs: +on.ms.toFixed(0), rewriteMs: +on.rewriteMs.toFixed(1), load1: +load1.toFixed(1), load1After: +loadavg()[0].toFixed(1) });
}
const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
console.log(JSON.stringify({ files: texts.length, pairs }, null, 0));
console.log(JSON.stringify({ medianOffPerFileMs: +(med(pairs.map((p) => p.offMs)) / texts.length).toFixed(3), medianOnPerFileMs: +(med(pairs.map((p) => p.onMs)) / texts.length).toFixed(3), medianRewritePerFileMs: +(med(pairs.map((p) => p.rewriteMs)) / texts.length).toFixed(4) }));
