// Throwaway probe (research 023-01, red proofs). For each first-parent commit C that adds or
// changes a test file, would that file, laid over C's parent, find every relative import it
// names? Reads git objects only (git show, cat-file); runs nothing.
// Usage: node overlay-imports.mjs <repo> <ref> <commits> <test-glob-regex>
import { execFileSync } from "node:child_process";
import { posix } from "node:path";
const [repo, ref, n, re] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const testRe = new RegExp(re);
const exists = (c, p) => { try { git("cat-file", "-e", `${c}:${p}`); return true; } catch { return false; } };
const candidates = (p) => {
  const noJs = p.replace(/\.(m|c)?js$/, "");
  return [p, `${noJs}.ts`, `${noJs}.tsx`, `${noJs}.mts`, `${p}.ts`, `${p}/index.ts`, `${p}.js`, `${p}.mjs`, `${p}.cjs`];
};
const commits = git("log", "--first-parent", "--format=%H", "-n", n, ref).trim().split("\n");
const rows = [];
for (const c of commits) {
  let parent; try { parent = git("rev-parse", `${c}^1`).trim(); } catch { continue; }
  const changed = git("diff-tree", "--no-commit-id", "-r", "--name-status", "--diff-filter=AM", parent, c).trim().split("\n").filter(Boolean);
  const srcChanged = changed.filter((l) => !testRe.test(l.split("\t")[1])).length;
  for (const line of changed) {
    const [st, path] = line.split("\t");
    if (!testRe.test(path)) continue;
    const text = git("show", `${c}:${path}`);
    // Static imports only, at the start of a line (a closing brace for a multi-line list): fixture
    // code inside template strings is mostly indented and not caught; see the README for the rest.
    const imps = [...text.matchAll(/^(?:import|export|\})[^\n]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1] ?? m[2]);
    const missing = [];
    for (const imp of new Set(imps)) {
      const p = posix.normalize(posix.join(posix.dirname(path), imp));
      if (!candidates(p).some((q) => exists(parent, q))) missing.push(p);
    }
    rows.push({ commit: c.slice(0, 9), status: st, path, srcChanged, relativeImports: new Set(imps).size, missingAtParent: missing });
  }
}
const sum = (f) => rows.filter(f).length;
console.log(JSON.stringify({ repo, ref, commits: commits.length, testFiles: rows.length,
  added: sum((r) => r.status === "A"), addedMissing: sum((r) => r.status === "A" && r.missingAtParent.length),
  modified: sum((r) => r.status === "M"), modifiedMissing: sum((r) => r.status === "M" && r.missingAtParent.length),
  withSourceChange: sum((r) => r.srcChanged > 0), withSourceChangeMissing: sum((r) => r.srcChanged > 0 && r.missingAtParent.length) }));
// Kind of each test file's missing imports: only test-side files (a helper, a testkit, a fixture,
// anything under test/ or __fixtures__), or at least one source file.
const testSide = (p) => /(^|\/)(test|tests|__fixtures__|fixtures)\//.test(p) || /\.testkit\.|fixture|helper/.test(p);
const kinds = { onlyTestSide: 0, source: 0 };
for (const r of rows.filter((r) => r.missingAtParent.length)) kinds[r.missingAtParent.every(testSide) ? "onlyTestSide" : "source"]++;
console.log(JSON.stringify({ missingKinds: kinds }));
for (const r of rows.filter((r) => r.missingAtParent.length).slice(0, 12)) console.log(JSON.stringify(r));
