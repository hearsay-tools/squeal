// THROWAWAY probe. Static closure per resolver against the observed closure (observe.mjs output).
// usage: node compare.mjs <fixtureRoot> <observed.json> [resolvers...] [--strip] [--verbose]
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { makeResolver, buildGraph, closureOf } from "./static-graph.mjs";
const args = process.argv.slice(2);
const [root, obsFile] = args; const strip = args.includes("--strip"), verbose = args.includes("--verbose");
const resolvers = args.slice(2).filter((a) => !a.startsWith("--"));
const realRoot = realpathSync(root);
const obs = JSON.parse(readFileSync(obsFile, "utf8"));
const pkg = join(realRoot, "packages/core");
const tests = readdirSync(join(pkg, "test/unit")).filter((f) => f.endsWith(".test.ts")).map((f) => join(pkg, "test/unit", f));
for (const name of resolvers.length ? resolvers : ["oxc", "enhanced", "ts", "ts-bundler", "hand"]) {
  const t0 = performance.now();
  const g = buildGraph(tests, makeResolver(name), { strip, types: args.includes("--types") });
  const ms = performance.now() - t0;
  let missing = new Map(), extra = new Map(), edgesN = 0;
  for (const s of g.deps.values()) edgesN += s.size;
  for (const t of tests) {
    const key = relative(realRoot, t);
    const st = new Set([...closureOf(g.deps, t)].map((p) => relative(realRoot, p)));
    const ob = new Set(obs[key] ?? []);
    for (const p of ob) if (!st.has(p)) missing.set(p, (missing.get(p) ?? 0) + 1);
    for (const p of st) if (!ob.has(p)) extra.set(p, (extra.get(p) ?? 0) + 1);
  }
  const unres = new Map(); for (const u of g.unresolved) { const k = `${u.spec} (${u.kind}: ${String(u.error).slice(0, 60)})`; unres.set(k, (unres.get(k) ?? 0) + 1); }
  console.log(`\n== ${name}${strip ? " +strip" : ""}${args.includes("--types") ? " +types" : ""}  modules=${g.deps.size} edges=${edgesN} total=${ms.toFixed(0)}ms parse=${g.timing.parseMs.toFixed(0)}ms resolve=${g.timing.resolveMs.toFixed(0)}ms`);
  console.log(`   missing (observed, not static): ${missing.size} paths`, [...missing.keys()].slice(0, verbose ? 99 : 6));
  console.log(`   extra (static, not observed): ${extra.size} paths`, [...extra.keys()].slice(0, verbose ? 99 : 6));
  console.log(`   unresolved: ${g.unresolved.length}`, [...unres.entries()].slice(0, verbose ? 99 : 6).map(([k, v]) => `${v}x ${k}`));
  console.log(`   glob dynamic imports: ${g.globs.length}`, g.globs.slice(0, 2).map(([f, c]) => `${relative(realRoot, f)}: ${c}`));
  console.log(`   computed dynamic imports: ${g.computed.length}`, g.computed.slice(0, 2).map(([f, c]) => `${relative(realRoot, f)}: ${c}`));
}
