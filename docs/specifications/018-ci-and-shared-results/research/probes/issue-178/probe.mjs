// Throwaway research probe. No product code or shared store is changed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(process.argv[2] ?? '.');
const cli = join(repo, 'plugins/claude-code/dist/cli/squeal.mjs');
const vitest = join(repo, 'node_modules/vitest/vitest.mjs');
const node = process.execPath;
const base = mkdtempSync(join(tmpdir(), 'squeal-issue-178-'));
const origin = join(base, 'origin');
const exported = join(base, 'export');
const env = { ...process.env, CI: 'true', NO_COLOR: '1' };
// Do not print or persist the inherited environment.
function command(executable, args, cwd, extra = {}) {
  console.log(`$ (cd ${cwd} && ${[executable, ...args].map(x => JSON.stringify(x)).join(' ')})`);
  const result = spawnSync(executable, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
  console.log(result.stdout.trim());
  console.log(result.stderr.trim());
  console.log(`exit=${result.status}; signal=${result.signal}; error=${result.error?.message ?? 'none'}`);
  return result;
}
function git(args, cwd = origin) {
  assert.equal(command('git', args, cwd).status, 0);
}
function record(shard, out, crash = false) {
  const load = loadavg()[0];
  console.log(`before record: load1=${load}; cpus=${cpus().length}; ISSUE_178_CRASH=${crash ? '1' : '0'}`);
  assert.ok(load <= cpus().length, 'host load exceeds CPU count; stop live probe');
  return command(node, [cli, 'ci', 'record', '--out', out, '--', node, vitest, 'run', `--shard=${shard}`, '--maxWorkers=1'], origin, { ISSUE_178_CRASH: crash ? '1' : '0' });
}
function exportParts(label, dirs, expected) {
  const out = join(base, `${label}.json.gz`);
  const result = command(node, [cli, 'ci', 'export', '--parts', ...dirs, '--out', out], exported);
  assert.equal(result.status, expected);
  assert.equal(existsSync(out), expected === 0);
  console.log(`${label}: outputExists=${existsSync(out)}`);
  return result;
}
try {
  console.log(JSON.stringify({ date: new Date().toISOString(), node: process.version, squeal: JSON.parse(readFileSync(join(repo, 'package.json'))).version, vitest: JSON.parse(readFileSync(join(repo, 'node_modules/vitest/package.json'))).version, load: loadavg(), cpus: cpus().length, base }));
  assert.ok(loadavg()[0] <= cpus().length, 'host load exceeds CPU count; skip live probe');
  mkdirSync(origin);
  writeFileSync(join(origin, '.gitignore'), 'node_modules\n');
  writeFileSync(join(origin, 'package.json'), JSON.stringify({ name: 'issue-178-probe', type: 'module', private: true }));
  writeFileSync(join(origin, 'vitest.config.js'), `export default { test: { include: ['*.test.js'], globalSetup: ['./global-setup.js'] } };\n`);
  writeFileSync(join(origin, 'global-setup.js'), `export default async function () {\n  if (process.env.ISSUE_178_CRASH === '1') {\n    Promise.reject(new Error('issue-178 deliberate unhandled error'));\n    await new Promise(resolve => setTimeout(resolve, 50));\n  }\n}\n`);
  for (const name of ['a', 'b']) {
    writeFileSync(join(origin, `${name}.test.js`), `import { test, expect } from 'vitest';\ntest('${name}', () => expect(1 + 1).toBe(2));\n`);
  }
  symlinkSync(join(repo, 'node_modules'), join(origin, 'node_modules'), 'dir');
  git(['init', '-q']);
  git(['add', '.']);
  git(['-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
  git(['clone', '-q', origin, exported], base);
  symlinkSync(join(repo, 'node_modules'), join(exported, 'node_modules'), 'dir');
  const first = join(base, 'complete-1');
  const second = join(base, 'complete-2');
  const crashed = join(base, 'crashed-1');
  assert.equal(record('1/2', first).status, 0);
  assert.equal(record('2/2', second).status, 0);
  exportParts('complete', [first, second], 0);
  assert.equal(record('1/2', crashed, true).status, 1);
  const liveParts = existsSync(crashed) ? readdirSync(crashed).filter(x => x.startsWith('squeal-part-')) : [];
  console.log(`live global-setup abort: parts=${liveParts.length}`);
  assert.equal(liveParts.length, 0);
  // Construct the end=crashed input from a real complete part. This probes
  // export's refusal, not Vitest's classification of an OS process crash.
  const part = JSON.parse(readFileSync(join(first, readdirSync(first)[0])));
  part.header.end = 'crashed';
  part.testFiles = [];
  delete part.records;
  mkdirSync(crashed, { recursive: true });
  writeFileSync(join(crashed, 'squeal-part-crashed.json'), JSON.stringify(part));
  console.log(`synthetic crashed part: ${JSON.stringify({ format: part.format, end: part.header.end, shard: part.header.shard, testFiles: part.testFiles.length })}`);
  assert.match(exportParts('mixed', [crashed, second], 1).stderr, /did not complete \(crashed\)/);
  assert.match(exportParts('missing', [second], 1).stderr, /no part of shard 1\/2/);
  console.log('VERDICT: export refusal reproduced with synthetic crashed part; live abort leaves no part; complete control exports; missing shard refuses.');
} finally {
  rmSync(base, { recursive: true, force: true });
}
