// Throwaway probe (015 R3). Static answer to "which test files spawn a child,
// and what does the child run", without any coverage of the child.
// Usage: node static-scan.mjs <repo> > static-scan.out.json
// For each Vitest test file: its test-side closure (relative imports that stay
// outside src/), whether that closure uses node:child_process, and which
// entries it names: a src/*.ts path, a dist/*.mjs bundle, a bundle build.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".");
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (n === "node_modules" || n === "fixtures") return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const tests = walk(join(repo, "test")).filter((p) => p.endsWith(".test.ts"));

const IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const c of [base, base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}
const SPAWN = /from ["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\)/;
const SRC_ENTRY = /["'`][^"'`]*\bsrc\/[\w/.-]+\.ts["'`]/g;
const DIST = /["'`][^"'`]*\bdist\/[\w/.-]+\.m?js["'`]/g;
const BUILD = /\b(buildDist|bundleOptions|pluginBundleOptions|buildPlugin|esbuild)\b/;
const TSX = /resolve\(["']tsx["']\)|["']tsx["']|tsx\/esm/;

const out = [];
for (const test of tests) {
  const seen = new Set([test]);
  const queue = [test];
  while (queue.length) {
    const f = queue.pop();
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const r = resolveImport(f, m[1]);
      if (r && !r.startsWith(join(repo, "src/")) && !seen.has(r)) { seen.add(r); queue.push(r); }
    }
  }
  let spawns = false, tsx = false, build = false;
  const srcEntries = new Set(), dist = new Set();
  for (const f of seen) {
    const text = readFileSync(f, "utf8");
    if (SPAWN.test(text)) spawns = true;
    if (TSX.test(text)) tsx = true;
    if (BUILD.test(text)) build = true;
    for (const m of text.matchAll(SRC_ENTRY)) srcEntries.add(m[0].slice(1, -1));
    for (const m of text.matchAll(DIST)) dist.add(m[0].slice(1, -1));
  }
  out.push({ test: relative(repo, test), closure: seen.size, spawns, tsx, build,
    srcEntries: [...srcEntries].filter((s) => existsSync(join(repo, s.replace(/^.*?\bsrc\//, "src/")))),
    dist: [...dist] });
}
const s = (f) => out.filter(f).length;
console.log(JSON.stringify({
  testFiles: out.length,
  e2e: s((t) => t.test.startsWith("test/e2e/")),
  spawning: s((t) => t.spawns),
  spawningNonE2e: s((t) => t.spawns && !t.test.startsWith("test/e2e/")),
  namesRealSrcEntryAndSpawns: s((t) => t.spawns && t.srcEntries.length > 0),
  tsxAndSpawns: s((t) => t.spawns && t.tsx),
  bundleAndSpawns: s((t) => t.spawns && (t.dist.length > 0 || t.build)),
  files: out,
}, null, 1));
