// Throwaway research probe, not a product test. No dependency installation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(process.argv[2]);
const say = (value) => console.log(JSON.stringify(value));
const guard = (step) => {
  const load = loadavg();
  say({ step, at: new Date().toISOString(), cpus: cpus().length, load });
  if (load[0] > cpus().length) throw new Error('SKIP: one-minute load exceeds CPU count');
};
guard('start');
const scratch = mkdtempSync(join(tmpdir(), 'squeal-issue-210-'));
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
const command = (cwd, executable, args) => {
  const start = Date.now();
  const result = spawnSync(executable, args, {
    cwd, env, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { ...result, ms: Date.now() - start };
};
const version = command(scratch, process.execPath, [cli, '--version']);
say({ cli, version: version.stdout.trim(), node: process.version });
const a = (edited) => `import test from 'node:test';
import assert from 'node:assert/strict';
test('changed passing callback', () => {
  const value = ${edited ? '1 + 1' : '2'};
  assert.equal(value, 2);
});
`;
try {
  for (const fails of [false, true]) {
    const label = fails ? 'unrelated-failure' : 'all-pass';
    const root = join(scratch, label);
    mkdirSync(join(root, 'test'), { recursive: true });
    const put = (name, value) => writeFileSync(join(root, name), value);
    put('package.json', JSON.stringify({ name: `issue-210-${label}`, private: true, type: 'module' }));
    put('squeal.config.json', JSON.stringify({
      runner: { tierSize: 1 },
      nodeTest: [{ name: 'probe', include: ['test/*.test.mjs'] }],
    }));
    put('test/a.test.mjs', a(false));
    put('test/b.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
test('unrelated base test', () => {
  assert.equal(1, ${fails ? '2' : '1'});
});
`);
    for (const args of [
      ['init', '-q', '-b', 'main'], ['add', 'package.json', 'squeal.config.json', 'test'],
      ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'base'],
    ]) assert.equal(command(root, 'git', args).status, 0);
    put('test/a.test.mjs', a(true));
    say({ label, diff: command(root, 'git', ['diff', '--name-only', 'main']).stdout.trim() });
    for (const repeat of [1, 2]) {
      guard(`${label}-${repeat}`);
      const args = [cli, 'code', '--base', 'main', '--json', '--timeout', '20', '--test', 'test/b.test.mjs'];
      const result = command(root, process.execPath, args);
      const report = JSON.parse(result.stdout);
      say({ label, repeat, command: [process.execPath, ...args], exit: result.status,
        ms: result.ms, report, stderr: result.stderr });
      assert.equal(result.status, fails ? 3 : 0);
      assert.equal(report.verdict, fails ? 'incomplete' : 'pass');
      assert.equal(report.functions.length, 1);
      const fn = report.functions[0];
      assert.equal(fn.coverage.share, 1);
      assert.deepEqual(fn.loaders.expected, ['test/a.test.mjs']);
      assert.deepEqual(fn.loaders.measured, ['test/a.test.mjs']);
      assert.equal(fn.state, fails ? 'incomplete' : 'pass');
      if (fails) assert.equal(fn.gap, 'test-failed');
      const run = report.runs[0];
      assert.deepEqual(run.completed, ['test/a.test.mjs', 'test/b.test.mjs']);
      assert.equal(run.failed.length, fails ? 1 : 0);
      if (fails) assert.equal(run.failed[0].path, 'test/b.test.mjs');
    }
  }
  say({ assertions: 'passed' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
