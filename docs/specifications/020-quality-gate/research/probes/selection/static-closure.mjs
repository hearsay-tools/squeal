// Throwaway probe (survey-020-15). Static walk of relative imports in a git
// commit, read with `git show <commit>:<path>`; writes nothing in the repo.
// It is an approximation of Vite's graph: relative specifiers only, no
// aliases, no package exports. Usage:
//   node static-closure.mjs <repo> <commit> <changed,...> <entry> [<entry>...]
// Prints, per entry, whether its static closure holds each changed path.
import { execFileSync } from "node:child_process";
import { posix } from "node:path";

const [repo, commit, changedArg, ...entries] = process.argv.slice(2);
const changed = changedArg.split(",");
const tree = new Set(
  execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", commit], {
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\n"),
);
const cache = new Map();
const read = (path) => {
  if (!cache.has(path)) {
    cache.set(
      path,
      execFileSync("git", ["-C", repo, "show", `${commit}:${path}`], { maxBuffer: 1 << 26 }).toString(),
    );
  }
  return cache.get(path);
};
const EXT = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];
function resolve(from, spec) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  const swapped = base.replace(/\.js$/, ".ts");
  for (const candidate of [base, swapped]) {
    for (const ext of EXT) if (tree.has(candidate + ext)) return candidate + ext;
  }
  return null;
}
const SPEC = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
function closure(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    for (const m of read(file).matchAll(SPEC)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec.startsWith(".")) continue;
      const target = resolve(file, spec);
      if (target !== null && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}
const out = {};
for (const entry of entries) {
  const files = closure(entry);
  out[entry] = { size: files.size, holds: changed.filter((p) => files.has(p)) };
}
console.log(JSON.stringify({ commit, changed, closures: out }, null, 1));
