// Throwaway probe for 015-03, question 4: can a file-level proxy stand in for
// "a changed function that no test runs"? Counts the src/ files a test file reaches
// through relative static and dynamic imports at the working tree's HEAD.
// Usage: node reach.mjs <repo> [cc-proxy-out.json]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? '.');
const files = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).trim().split('\n');
const code = files.filter((f) => /\.(ts|mts|js|mjs)$/.test(f) && !f.endsWith('.d.ts') && !/(^|\/)(dist|node_modules)\//.test(f));
const src = new Set(code.filter((f) => f.startsWith('src/')));
const tests = code.filter((f) => /\.test\.(ts|mts|js|mjs)$/.test(f) && !f.startsWith('test/e2e/'));
const known = new Set(code);

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
function deps(file) {
  const text = readFileSync(path.join(repo, file), 'utf8');
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const stem = base.replace(/\.(js|mjs|ts|mts)$/, '');
    for (const c of [base, `${stem}.ts`, `${stem}.mts`, `${stem}.js`, `${stem}.mjs`, `${base}/index.ts`]) {
      if (known.has(c)) { out.push(c); break; }
    }
  }
  return out;
}

const reached = new Set();
const queue = [...tests];
while (queue.length) {
  const f = queue.pop();
  for (const d of deps(f)) if (!reached.has(d)) { reached.add(d); queue.push(d); }
}
const srcReached = [...src].filter((f) => reached.has(f));
const result = { tests: tests.length, srcFiles: src.size, srcReachedByATest: srcReached.length,
  srcNotReached: [...src].filter((f) => !reached.has(f)) };
const outFile = process.argv[3];
if (outFile && existsSync(outFile)) {
  // cc-proxy's per-function rows are not in its summary; re-derive changed files from git.
  const changed = new Set(execFileSync('git', ['-C', repo, 'log', '-100', '--name-only', '--format='], { encoding: 'utf8' })
    .trim().split('\n').filter((f) => src.has(f)));
  result.changedSrcFilesStillPresent = changed.size;
  result.changedSrcFilesReached = [...changed].filter((f) => reached.has(f)).length;
}
console.log(JSON.stringify(result, null, 2));
