// Throwaway selection probe. No browser, server, daemon, or product edits.
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [shape, mode] = process.argv.slice(2);
if (!['narrow', 'shared'].includes(shape) || !['default', 'test', 'group'].includes(mode)) {
  throw new Error('Usage: node run.mjs narrow|shared default|test|group');
}
const load = loadavg()[0];
const cpuCount = cpus().length;
console.log(JSON.stringify({ at: new Date().toISOString(), load, cpuCount, shape, mode }));
if (load > cpuCount) {
  console.log('Not reproduced, because one-minute load exceeds CPU count.');
  process.exit(77);
}
const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
const out = join(import.meta.dirname, 'out');
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(out, `${shape}-${mode}-`));
function put(file, text) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
put('package.json', JSON.stringify({ name: 'issue-203-throwaway', private: true, type: 'module' }));
put('.gitignore', 'node_modules/\nmarks/\n');
put('squeal.config.json', JSON.stringify({ checks: [
  { name: 'browser', runner: 'vitest', project: 'browser', at: 'manual' },
] }));
put('vitest.config.ts', `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { maxWorkers: 1, projects: [
  { test: { name: 'unit', include: ['unit/**/*.test.ts'], maxWorkers: 1 } },
  { test: { name: 'browser', include: ['e2e/**/*.test.ts'], maxWorkers: 1 } }
] } });\n`);
put('src/helper.ts', 'export function value() { return 1; }\n');
function testBody(name, changed = false) {
  return `import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { value } from '../src/helper';
it('${name}', () => {
  writeFileSync('marks/${name}', 'ran');
  expect(value()).toBe(${changed ? '1 + 0' : '1'});
});\n`;
}
for (const name of ['target', 'peer1', 'peer2']) put(`e2e/${name}.test.ts`, testBody(name));
put('unit/basic.test.ts', testBody('unit'));
symlinkSync(resolve(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
mkdirSync(join(root, 'marks'));
git('init', '-q', '-b', 'main');
git('add', 'package.json', '.gitignore', 'squeal.config.json', 'vitest.config.ts', 'src', 'e2e', 'unit');
git('-c', 'user.name=Research Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'base');
put('e2e/target.test.ts', testBody('target', true));
put('unit/basic.test.ts', testBody('unit', true));
if (shape === 'shared') put('src/helper.ts', 'export function value() { return 1 + 0; }\n');
const cli = '/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.457/dist/cli/squeal.mjs';
const args = ['--disable-warning=ExperimentalWarning', cli, 'code', '--base', 'main', '--json', '--timeout', '20'];
if (mode === 'test') args.push('--test', 'e2e/target.test.ts');
if (mode === 'group') args.push('--group', 'browser');
console.log(JSON.stringify({ cwd: root, command: [process.execPath, ...args] }));
const start = Date.now();
const ran = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 40000 });
writeFileSync(join(root, 'report.json'), ran.stdout ?? '');
writeFileSync(join(root, 'stderr.txt'), ran.stderr ?? '');
console.log(JSON.stringify({ exit: ran.status, signal: ran.signal, elapsedMs: Date.now() - start, error: ran.error?.message }));
console.log(ran.stderr);
const report = JSON.parse(ran.stdout);
const { readdirSync } = await import('node:fs');
console.log(JSON.stringify({ versions: report.versions, verdict: report.verdict, counts: report.counts,
  scope: report.scope, runs: report.runs, functions: report.functions, markers: readdirSync(join(root, 'marks')) }, null, 2));
const expected = mode === 'default' ? ['unit'] : mode === 'group' && shape === 'shared'
  ? ['peer1', 'peer2', 'target', 'unit'] : ['target', 'unit'];
const markers = readdirSync(join(root, 'marks')).sort();
if (JSON.stringify(markers) !== JSON.stringify(expected.sort())) throw new Error(`Unexpected markers: ${markers}`);
if (ran.status !== (mode === 'default' ? 3 : 0)) throw new Error(`Unexpected exit: ${ran.status}`);
