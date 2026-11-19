// Throwaway research probe. Run from the repository root with pnpm exec tsx.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createVitestAdapter } from '../../../../../../src/runners/vitest/index.js';
import { assembleClosure, createDeclaredInputs } from '../../../../../../src/core/keys/closure.js';
import { checkKey } from '../../../../../../src/core/keys/check-key.js';
import { ReverseIndex } from '../../../../../../src/core/keys/reverse-index.js';

const repo = process.cwd();
console.log(JSON.stringify({ uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), cpus: cpus().length, load: loadavg(), node: process.version, sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), version: JSON.parse(readFileSync('package.json', 'utf8')).version }));
if (loadavg()[0] > cpus().length) { console.log('SKIPPED: load above CPU count'); process.exit(0); }
const root = mkdtempSync(join(tmpdir(), 'squeal-issue-249-'));
const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const manifest = { name: 'issue-249-probe', type: 'module', version: '1.0.0', scripts: { demo: 'echo first' } };
write('package.json', JSON.stringify(manifest));
write('vitest.config.ts', 'export default { test: { include: ["test/*.test.ts"], pool: "forks", maxWorkers: 1, fileParallelism: false } };');
write('src/value.ts', 'export const value = 1;');
for (const name of ['a', 'b']) write(`test/${name}.test.ts`, 'import { it, expect } from "vitest"; import { value } from "../src/value.ts"; it("value", () => expect(value).toBe(1));');
write('test/data.test.ts', 'import { it, expect } from "vitest"; import { readFileSync } from "node:fs"; it("scripts are data", () => expect(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.demo).toMatch(/^echo /));');
symlinkSync(resolve(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
let adapter;
try {
  adapter = await createVitestAdapter({ root, observe: () => true, cache: false });
  const files = await adapter.testFiles();
  const report = await adapter.run(files, { runId: 'issue-249', logDir: join(root, '.logs'), timeoutMs: 30000, workers: 1 });
  console.log(JSON.stringify({ phase: 'run', end: report.end, completed: report.completed, outcomes: report.results.map(r => r.outcome) }));
  const declared = createDeclaredInputs({ 'test/data.test.ts': ['package.json'] }, ['package.json']);
  const reverse = new ReverseIndex();
  const closures = [];
  const hash = (path: string) => { const abs = join(root, path); if (!existsSync(abs)) return null; const bytes = readFileSync(abs); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };
  for (const file of files) {
    const runner = await adapter.closure(file);
    const seen = report.observed?.find(o => o.testFile.path === file.path)?.paths ?? [];
    const closure = assembleClosure(runner, declared.for(file.path), seen);
    reverse.set(file, closure.paths);
    closures.push(closure);
    console.log(JSON.stringify({ phase: 'closure', file: file.path, observedManifests: seen.filter(p => p.endsWith('package.json')), runnerManifests: runner.paths.filter(p => p.endsWith('package.json')), declared: declared.for(file.path) }));
  }
  const before = closures.map(c => checkKey('fixed-environment', c, hash));
  write('package.json', JSON.stringify({ ...manifest, scripts: { demo: 'echo second' } }));
  console.log(JSON.stringify({ phase: 'scripts-only-edit', selectedByReverseIndex: reverse.referencing(['package.json']).map(f => f.path), keyChanged: closures.map((c, i) => ({ file: c.testFile.path, changed: checkKey('fixed-environment', c, hash) !== before[i] })) }));
  const controls = closures.map(c => assembleClosure({ testFile: c.testFile, paths: [c.testFile.path], complete: false }, declared.for(c.testFile.path), []));
  const controlBefore = controls.map(c => checkKey('fixed-environment', c, hash));
  write('package.json', JSON.stringify({ ...manifest, scripts: { demo: 'echo third' } }));
  console.log(JSON.stringify({ phase: 'declared-only-control', keyChanged: controls.map((c, i) => ({ file: c.testFile.path, changed: checkKey('fixed-environment', c, hash) !== controlBefore[i] })) }));
} finally {
  await adapter?.close();
  rmSync(root, { recursive: true, force: true });
}
