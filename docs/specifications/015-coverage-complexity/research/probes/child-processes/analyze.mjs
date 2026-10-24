// Throwaway probe (015 R3). Joins in-process coverage (run 2) with child
// coverage (run 1, converted per test file) by function start position.
// Usage: node analyze.mjs <repo> <inproc json[,more]> <child-conv[,more]> <maps> <static-scan.out.json>
// Several in-process reports are a union: a function is covered when any
// report ran it (matched by its body start). Several child directories are a
// union per test file.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const [repo, inprocArg, convArg, mapsDir, staticFile] = process.argv.slice(2);
const rel = (p) => relative(repo, p);
const [inproc, ...moreInproc] = inprocArg.split(",").map((f) => JSON.parse(readFileSync(resolve(f), "utf8")));
const extraHits = new Set();
for (const more of moreInproc) {
  for (const [path, c] of Object.entries(more)) {
    for (const [id, fn] of Object.entries(c.fnMap)) if (c.f[id] > 0) extraHits.add(`${path}:${fn.loc.start.line}:${fn.loc.start.column}`);
  }
}

// The universe: every function the in-process report lists for src/**/*.ts.
const fns = []; // { file, name, line, col, endLine, hit }
for (const [path, c] of Object.entries(inproc)) {
  for (const [id, fn] of Object.entries(c.fnMap)) {
    fns.push({ file: rel(path), name: fn.name, line: fn.loc.start.line, col: fn.loc.start.column,
      declLine: fn.decl.start.line, declCol: fn.decl.start.column, endLine: fn.loc.end.line,
      hit: c.f[id] > 0 || extraHits.has(`${path}:${fn.loc.start.line}:${fn.loc.start.column}`) });
  }
}

// Child functions that ran, per test file: file -> [{ line, col, name }].
// V8's class initializers and each module's top-level function are not
// functions of the counter or of the in-process report; they are left out.
const PSEUDO = (fn, path) => fn.name === "__name" || fn.name.startsWith("<") || fn.name === path ||
  fn.name === rel(path) || (fn.loc.start.line === 1 && fn.loc.start.column === 0 && fn.name.includes("/"));
const testName = (f) => f.replace(/\.json$/, "").replaceAll("__", "/");
const child = new Map(); // test -> Map(file -> [{line,col,name}])
for (const convDir of convArg.split(",")) for (const f of readdirSync(convDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
  const cov = JSON.parse(readFileSync(join(convDir, f), "utf8"));
  const byFile = child.get(testName(f)) ?? new Map();
  for (const [path, c] of Object.entries(cov)) {
    const ran = Object.entries(c.fnMap).filter(([id, fn]) => c.f[id] > 0 && !PSEUDO(fn, path))
      .map(([, fn]) => ({ line: fn.loc.start.line, col: fn.loc.start.column, name: fn.name }));
    if (ran.length) byFile.set(rel(path), [...(byFile.get(rel(path)) ?? []), ...ran]);
  }
  child.set(testName(f), byFile);
}

// The in-process report (Vitest 5's AST mapping) gives each function a decl
// (its name, or the arrow's start) and a loc that starts at its body. V8 starts
// a function at the keyword (`export function f(` at "function"), at a
// method's name, or at an arrow's parameters. A child function matches the
// in-process function whose span from its decl's line to its body start holds
// the child's start; on ties, the nearest decl column on the same line.
const before = (a, b) => a.line < b.line || (a.line === b.line && a.col <= b.col);
const byFile = new Map();
fns.forEach((fn, i) => { fn.i = i; (byFile.get(fn.file) ?? byFile.set(fn.file, []).get(fn.file)).push(fn); });
function match(file, r) {
  let best, bestScore = Infinity;
  for (const fn of byFile.get(file) ?? []) {
    const body = { line: fn.line, col: fn.col };
    if (r.line < fn.declLine || !before(r, body)) continue;
    const score = (r.line - fn.declLine) * 1000 + (r.line === fn.declLine ? Math.abs(r.col - fn.declCol) : 0);
    if (score < bestScore) { bestScore = score; best = fn; }
  }
  return best;
}
const reached = new Map(); // fn index -> Set(test)
let childRan = 0, childMatched = 0;
const seenChild = new Set();
for (const [test, files] of child) {
  for (const [file, ran] of files) {
    for (const r of ran) {
      const fn = match(file, r);
      const key = `${file}:${r.line}:${r.col}`;
      if (!seenChild.has(key)) { seenChild.add(key); childRan++; if (fn) childMatched++; }
      if (fn) (reached.get(fn.i) ?? reached.set(fn.i, new Set()).get(fn.i)).add(test);
    }
  }
}
const reachedBy = (fn) => [...(reached.get(fn.i) ?? [])];

const isE2e = (t) => t.startsWith("test/e2e/");
const top = (f) => f.split("/").slice(0, f.startsWith("src/core/") ? 3 : 2).join("/");
const rows = fns.map((fn) => {
  const tests = fn.hit ? [] : reachedBy(fn);
  return { ...fn, childTests: tests, childAny: reachedBy(fn).length, childNonE2e: tests.filter((t) => !isE2e(t)).length, childE2e: tests.filter(isE2e).length };
});
const uncovered = rows.filter((r) => !r.hit);
const childOnly = uncovered.filter((r) => r.childTests.length);
const childOnlyNonE2e = childOnly.filter((r) => r.childNonE2e > 0);
const childOnlyE2eOnly = childOnly.filter((r) => r.childNonE2e === 0);

// Static closure of the shipped entries: every src file a bundle map names.
function walk(d) { return readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]); }
const bundleSrc = new Set();
for (const m of walk(mapsDir).filter((f) => f.endsWith(".map"))) {
  for (const s of JSON.parse(readFileSync(m, "utf8")).sources) { const i = s.indexOf("src/"); if (i >= 0 && !s.includes("node_modules")) bundleSrc.add(s.slice(i)); }
}
const inStatic = (r) => bundleSrc.has(r.file);

// Test files whose children ran src code, against the static scan's flags.
const scan = JSON.parse(readFileSync(staticFile, "utf8")).files;
const scanBy = new Map(scan.map((s) => [s.test, s]));
const reachingTests = [...child].filter(([, byFile]) => byFile.size > 0).map(([t]) => t);
const flag = (pred) => reachingTests.filter((t) => { const s = scanBy.get(t); return s && pred(s); }).length;

const count = (list, key) => Object.entries(list.reduce((a, r) => ({ ...a, [key(r)]: (a[key(r)] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
const out = {
  functions: rows.length,
  srcFiles: Object.keys(inproc).length,
  inProcessUncovered: uncovered.length,
  inProcessUncoveredFiles: new Set(uncovered.map((r) => r.file)).size,
  filesWithNoFunctionRun: [...new Set(rows.map((r) => r.file))].filter((f) => rows.every((r) => r.file !== f || !r.hit)),
  filesWithNoFunctionRunInAnyProcess: [...new Set(rows.map((r) => r.file))].filter((f) => rows.every((r) => r.file !== f || (!r.hit && !r.childTests.length))),
  childOnly: childOnly.length,
  childOnlyNonE2e: childOnlyNonE2e.length,
  childOnlyE2eOnly: childOnlyE2eOnly.length,
  uncoveredAnywhere: uncovered.length - childOnly.length,
  join: { childFunctionsRan: childRan, matchedAnInProcessFunction: childMatched,
    inProcessCoveredAlsoChild: rows.filter((r) => r.hit && r.childAny).length },
  staticClosure: {
    srcFilesInAnyBundle: bundleSrc.size,
    uncoveredInClosure: uncovered.filter(inStatic).length,
    childOnlyInClosure: childOnly.filter(inStatic).length,
    childOnlyOutsideClosure: childOnly.filter((r) => !inStatic(r)).map((r) => `${r.file}:${r.line} ${r.name}`),
  },
  testsWithChildSrc: reachingTests.length,
  testsWithChildSrcE2e: reachingTests.filter(isE2e).length,
  staticScanOnThose: { spawns: flag((s) => s.spawns), namesSrcEntry: flag((s) => s.srcEntries.length > 0), tsx: flag((s) => s.tsx), bundle: flag((s) => s.dist.length > 0 || s.build), anySignal: flag((s) => s.srcEntries.length > 0 || s.tsx || s.dist.length > 0 || s.build) },
  staticScanFlaggedAll: { spawns: scan.filter((s) => s.spawns).length, anySignal: scan.filter((s) => s.spawns && (s.srcEntries.length > 0 || s.tsx || s.dist.length > 0 || s.build)).length },
  childOnlyByDir: count(childOnly, (r) => top(r.file)),
  uncoveredByDir: count(uncovered, (r) => top(r.file)),
  childOnlyTestsPerFunction: count(childOnly, (r) => String(Math.min(r.childTests.length, 10))),
};
writeFileSync(join(dirname(staticFile), "analyze.out.json"), JSON.stringify(out, null, 1));
writeFileSync(join(dirname(staticFile), "child-only.out.tsv"),
  ["file\tline\tname\tchildTests\tnonE2e\te2e", ...childOnly.map((r) => `${r.file}\t${r.line}\t${r.name}\t${r.childTests.length}\t${r.childNonE2e}\t${r.childE2e}`)].join("\n") + "\n");
writeFileSync(join(dirname(staticFile), "uncovered-anywhere.out.tsv"),
  ["file\tline\tname", ...uncovered.filter((r) => !r.childTests.length).map((r) => `${r.file}\t${r.line}\t${r.name}`)].join("\n") + "\n");
console.log(JSON.stringify({ ...out, staticClosure: { ...out.staticClosure, childOnlyOutsideClosure: out.staticClosure.childOnlyOutsideClosure.length }, filesWithNoFunctionRun: out.filesWithNoFunctionRun.length }, null, 1));
