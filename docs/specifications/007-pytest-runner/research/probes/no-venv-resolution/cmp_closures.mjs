// Throwaway (007-04): per test file, compare the closure and its resolution candidates between two graphs.
// node cmp_closures.mjs <root> <a.json> <b.json>   (graphs from ast_graph.py or graph.mjs)
// Closure as spec 007 D4: the test file, the conftest chain from the root down, literal pytest_plugins of
// those conftests, and the transitive edges of all of them. Candidates: the union over the closure's files.
import fs from "node:fs";
import path from "node:path";
const [root, fa, fb] = process.argv.slice(2);
const [A, B] = [fa, fb].map((f) => JSON.parse(fs.readFileSync(f, "utf8")).files);
const plugins = (c) => {
  const m = /^pytest_plugins\s*=\s*[[(]([^\])]*)[\])]/m.exec(fs.readFileSync(path.join(root, c), "utf8"));
  return m ? [...m[1].matchAll(/["']([\w.]+)["']/g)].map((x) => x[1].replace(/\./g, "/") + ".py") : [];
};
const closure = (G, test) => {
  const todo = [test];
  const parts = test.split("/").slice(0, -1);
  for (let i = 0; i <= parts.length; i++) {
    const c = [...parts.slice(0, i), "conftest.py"].join("/");
    if (G[c]) { todo.push(c); todo.push(...plugins(c).filter((p) => G[p])); }
  }
  const seen = new Set();
  while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); todo.push(...(G[f]?.edges ?? [])); }
  const cands = new Set([...seen].flatMap((f) => G[f]?.candidates ?? []));
  return { files: seen, cands };
};
const tests = Object.keys(A).filter((f) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f)).sort();
const diff = (x, y) => [...x].filter((v) => !y.has(v));
let filesDiff = 0, candDiff = 0, keyDiff = 0;
const examples = [];
const why = {};
for (const t of tests) {
  const a = closure(A, t), b = closure(B, t);
  const fa_ = diff(a.files, b.files), fb_ = diff(b.files, a.files), ca = diff(a.cands, b.cands), cb = diff(b.cands, a.cands);
  if (fa_.length || fb_.length) filesDiff++;
  if (ca.length || cb.length) candDiff++;
  if (fa_.length || fb_.length || ca.length || cb.length) {
    keyDiff++;
    for (const p of [...fa_.map((x) => `files only in A: ${x}`), ...fb_.map((x) => `files only in B: ${x}`), ...ca.map((x) => `cand only in A: ${x}`), ...cb.map((x) => `cand only in B: ${x}`)]) {
      const k = p.startsWith("cand") ? p.replace(/(\/__init__)?\.py$/, "").replace(/: .*\//, ": import ") : p; why[k] = (why[k] ?? 0) + 1;
    }
    if (examples.length < 3) examples.push({ test: t, filesOnlyA: fa_.slice(0, 5), filesOnlyB: fb_.slice(0, 5), candOnlyA: ca.slice(0, 5), candOnlyB: cb.slice(0, 5) });
  }
}
const top = Object.entries(why).map(([k, v]) => [k, v / 1]).sort((x, y) => y[1] - x[1]).slice(0, 12);
console.log(JSON.stringify({ tests: tests.length, closure_files_differ: filesDiff, candidates_differ: candDiff, key_inputs_differ: keyDiff, most_common: top, examples }, null, 1));
