// THROWAWAY probe. Q1/Q4/Q5 costs on fixtures/big: cold build, full re-resolve with parses kept,
// one-file edit, resolver-cache staleness after structural changes, reverse index and lookups.
// usage: node bench-static.mjs [fixtureRoot] [runs]
import { readdirSync, readFileSync, realpathSync, writeFileSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { makeResolver, buildGraph, closureOf, parseFile } from "./static-graph.mjs";
const root = realpathSync(process.argv[2] ?? "fixtures/big"), RUNS = Number(process.argv[3] ?? 7);
const pkg = join(root, "packages/core");
const tests = readdirSync(join(pkg, "test/unit")).filter((f) => f.endsWith(".test.ts")).map((f) => join(pkg, "test/unit", f));
const stat = (xs) => { const s = [...xs].sort((a, b) => a - b); return `median ${s[s.length >> 1].toFixed(1)} ms (min ${s[0].toFixed(1)}, max ${s[s.length - 1].toFixed(1)})`; };
const time = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r]; };
console.log(`node ${process.version}, ${tests.length} test files, ${RUNS} runs each`);

// --- Q1/Q4: cold build, full re-resolve with parse cache, warm re-resolve
for (const name of ["oxc", "enhanced", "ts-bundler", "hand"]) {
  const cold = [], reresolve = [], warm = [];
  let g;
  for (let i = 0; i < RUNS; i++) {
    const r = makeResolver(name);
    const parsed = new Map();
    let ms; [ms, g] = time(() => buildGraph(tests, r, { parsed })); cold.push(ms);
    r.clear(); [ms] = time(() => buildGraph(tests, r, { parsed })); reresolve.push(ms);
    [ms] = time(() => buildGraph(tests, r, { parsed })); warm.push(ms);
  }
  let edges = 0; for (const s of g.deps.values()) edges += s.size;
  console.log(`${name.padEnd(10)} modules ${g.deps.size} edges ${edges} | cold ${stat(cold)} | re-resolve all, parses kept, resolver cache cleared ${stat(reresolve)} | warm ${stat(warm)}`);
}

// --- parse only: es-module-lexer vs oxc-parser vs ts.preProcessFile vs stripTypeScriptTypes+lexer
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const ts = require("ts6"); const oxc = require("oxc-parser");
  const g = buildGraph(tests, makeResolver("oxc"));
  const srcs = [...g.deps.keys()].filter((f) => /\.[mc]?[jt]s$/.test(f)).map((f) => [f, readFileSync(f, "utf8")]);
  const bytes = srcs.reduce((a, [, s]) => a + s.length, 0);
  const p = { "es-module-lexer": [], "strip+lexer": [], "oxc-parser": [], "ts.preProcessFile": [] };
  for (let i = 0; i < RUNS; i++) {
    p["es-module-lexer"].push(time(() => srcs.forEach(([f, s]) => parseFile(f, s)))[0]);
    p["strip+lexer"].push(time(() => srcs.forEach(([f, s]) => parseFile(f, s, { strip: true })))[0]);
    p["oxc-parser"].push(time(() => srcs.forEach(([f, s]) => oxc.parseSync(f, s)))[0]);
    p["ts.preProcessFile"].push(time(() => srcs.forEach(([, s]) => ts.preProcessFile(s, true, true)))[0]);
  }
  console.log(`\nparse only, ${srcs.length} files, ${(bytes / 1024).toFixed(0)} KiB (sources in memory):`);
  for (const [k, v] of Object.entries(p)) console.log(`  ${k.padEnd(18)} ${stat(v)}`);
}

// --- Q4: one-file content edit with a warm resolver: re-parse + resolve that file's specifiers
for (const name of ["oxc", "enhanced", "ts-bundler", "hand"]) {
  const r = makeResolver(name); buildGraph(tests, r);
  const f = join(pkg, "src/m500.ts"); const xs = [];
  for (let i = 0; i < 200; i++) xs.push(time(() => { const p = parseFile(f, readFileSync(f, "utf8")); for (const { spec, kind } of p.specs) r(spec, f, kind); })[0]);
  console.log(`one-file edit (${name}, warm): ${stat(xs)}`);
}

// --- Q4: structural changes. Does a kept resolver cache go stale? Does a cleared one match a fresh build?
{
  const closures = (g) => new Map(tests.map((t) => [t, [...closureOf(g.deps, t)].sort().join("\n")]));
  const edgeSets = (g) => new Map([...g.deps].map(([f, ds]) => [f, [...ds].sort().join("\n")]));
  const diffEdges = (a, b) => new Set([...a.keys(), ...b.keys()].filter((f) => a.get(f) !== b.get(f))).size;
  const diff = (a, b) => tests.filter((t) => a.get(t) !== b.get(t)).length;
  const edits = [
    ["delete src/m010.ts", () => renameSync(join(pkg, "src/m010.ts"), join(pkg, "src/m010.ts.bak")), () => renameSync(join(pkg, "src/m010.ts.bak"), join(pkg, "src/m010.ts"))],
    ["add src/edge/paths-target/index.ts shadowing nothing, then delete paths-target.ts", () => { mkdirSync(join(pkg, "src/edge/paths-target")); writeFileSync(join(pkg, "src/edge/paths-target/index.ts"), `export const c = () => 1;\n`); renameSync(join(pkg, "src/edge/paths-target.ts"), join(pkg, "src/edge/paths-target.ts.bak")); },
      () => { rmSync(join(pkg, "src/edge/paths-target"), { recursive: true }); renameSync(join(pkg, "src/edge/paths-target.ts.bak"), join(pkg, "src/edge/paths-target.ts")); }],
    ["edit packages/util/package.json exports ./str -> ./src/u299.ts", () => { const p = join(root, "packages/util/package.json"); const j = JSON.parse(readFileSync(p, "utf8")); writeFileSync(p + ".bak", JSON.stringify(j, null, 2)); j.exports["./str"] = "./src/u299.ts"; writeFileSync(p, JSON.stringify(j, null, 2)); },
      () => { const p = join(root, "packages/util/package.json"); renameSync(p + ".bak", p); }],
    ["edit packages/core/tsconfig.json paths gains ~/m220 -> ./src/m000.ts", () => { const p = join(pkg, "tsconfig.json"); const j = JSON.parse(readFileSync(p, "utf8")); writeFileSync(p + ".bak", JSON.stringify(j, null, 2)); j.compilerOptions.paths = { "~/m220": ["./src/m000.ts"], ...j.compilerOptions.paths }; writeFileSync(p, JSON.stringify(j, null, 2)); },
      () => { const p = join(pkg, "tsconfig.json"); renameSync(p + ".bak", p); }],
  ];
  console.log("\nstructural changes (test files whose closure differs from a fresh build):");
  for (const name of ["oxc", "enhanced", "ts-bundler", "hand"]) {
    for (const [label, apply, undo] of edits) {
      const r = makeResolver(name); const parsed = new Map();
      const g0 = buildGraph(tests, r, { parsed });
      apply();
      try {
        const gt = buildGraph(tests, makeResolver(name));
        const gs = buildGraph(tests, r, { parsed });
        r.clear();
        const [ms, g] = time(() => buildGraph(tests, r, { parsed }));
        console.log(`  ${name.padEnd(10)} ${label}: edit changes ${diffEdges(edgeSets(g0), edgeSets(gt))} modules' edges, ${diff(closures(g0), closures(gt))} test closures | kept cache wrong: ${diffEdges(edgeSets(gs), edgeSets(gt))} modules, ${diff(closures(gs), closures(gt))} tests | cleared cache wrong: ${diffEdges(edgeSets(g), edgeSets(gt))} modules, ${diff(closures(g), closures(gt))} tests | re-resolve ${ms.toFixed(0)} ms`);
      } finally { undo(); }
    }
  }
}

// --- Q5: reverse index. direct = test files with the path in one hop (or the test file itself); transitive = rest of closure.
{
  const g = buildGraph(tests, makeResolver("oxc"));
  const [buildMs, idx] = time(() => {
    const direct = new Map(), all = new Map();
    const add = (m, k, v) => { let s = m.get(k); if (!s) m.set(k, (s = new Set())); s.add(v); };
    for (const t of tests) {
      add(direct, t, t); for (const d of g.deps.get(t)) add(direct, d, t);
      for (const p of closureOf(g.deps, t)) add(all, p, t);
    }
    return { direct, all };
  });
  let entries = 0; for (const s of idx.all.values()) entries += s.size;
  const affected = (changed) => {
    const direct = new Set(), trans = new Set();
    for (const c of changed) { for (const t of idx.direct.get(c) ?? []) direct.add(t); for (const t of idx.all.get(c) ?? []) trans.add(t); }
    for (const t of direct) trans.delete(t);
    return { direct, trans };
  };
  // the alternative without a closure index: reverse BFS over reverse edges
  const rev = new Map(); for (const [f, ds] of g.deps) for (const d of ds) { if (!rev.has(d)) rev.set(d, new Set()); rev.get(d).add(f); }
  const testSet = new Set(tests);
  const affectedBfs = (changed) => {
    const seen = new Set(changed), st = [...changed], hit = new Set();
    while (st.length) { const x = st.pop(); if (testSet.has(x)) hit.add(x); for (const p of rev.get(x) ?? []) if (!seen.has(p)) { seen.add(p); st.push(p); } }
    return hit;
  };
  const files = [...g.deps.keys()];
  const leaf = join(pkg, "src/m000.ts"), top = join(pkg, "src/m699.ts");
  const runs = (fn) => { const xs = []; for (let i = 0; i < 1000; i++) xs.push(time(fn)[0]); return stat(xs); };
  console.log(`\nreverse index: built in ${buildMs.toFixed(1)} ms, ${idx.all.size} paths, ${entries} (path, test file) entries`);
  for (const [label, changed] of [["leaf m000.ts", [leaf]], ["top m699.ts", [top]], ["10 random files", files.slice(100, 110)]]) {
    const a = affected(changed);
    console.log(`  ${label}: direct ${a.direct.size}, transitive ${a.trans.size}; index lookup ${runs(() => affected(changed))}; reverse BFS ${runs(() => affectedBfs(changed))} (same set: ${affectedBfs(changed).size === a.direct.size + a.trans.size})`);
  }
}
