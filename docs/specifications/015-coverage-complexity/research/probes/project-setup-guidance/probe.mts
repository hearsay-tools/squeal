// Throwaway research probe. No daemon, test runner, install or model session.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../../../../../src/core/daemon/policy.js';
import { createInputMatcher } from '../../../../../../src/core/keys/glob.js';
import { readRepoFacts } from '../../../../../../src/cli/setup/repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../../..');
const cli = join(repo, 'plugins/claude-code/dist/cli/squeal.mjs');
const start = Date.now();
const scratch = mkdtempSync(join(tmpdir(), 'squeal-015-90-'));
const env = { ...process.env, PATH: '/usr/bin:/bin' };
const calls: object[] = [];
function run(cwd: string, command: string, args: string[], expected = 0) {
  const begin = Date.now();
  const r = spawnSync(command, args, { cwd, env, input: '', encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error);
  assert.equal(r.status, expected, r.stderr || r.stdout);
  calls.push({ command: [command === process.execPath ? 'node' : command, ...args.map(a => a === cli ? '<bundled-cli>' : a)], exit: r.status, ms: Date.now() - begin, stdoutChars: r.stdout.length, stderrChars: r.stderr.length });
  return r.stdout;
}
function put(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function snapshot(root: string): string {
  const hash = createHash('sha256');
  function walk(dir: string) {
    for (const ent of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, ent.name);
      hash.update(path);
      if (ent.isDirectory()) walk(path);
      else hash.update(readFileSync(join(root, path)));
    }
  }
  walk('');
  return hash.digest('hex');
}
function projectPlan(root: string) {
  const p = JSON.parse(run(root, process.execPath, [cli, 'setup', '--plan', '--json']));
  return { schemaVersion: p.schemaVersion, runners: p.runners, config: p.config, slow: p.slow, excluded: p.excluded, warmup: p.warmup, outdated: p.outdated, keys: Object.keys(p) };
}
const results: object[] = [];
try {
  for (const layout of ['separate', 'colocated']) {
    const root = join(scratch, layout);
    mkdirSync(root);
    const test = layout === 'separate' ? 'test/math.test.ts' : 'src/math.test.ts';
    const helper = layout === 'separate' ? 'test/helpers/numbers.ts' : 'src/test-support/numbers.ts';
    const fixture = layout === 'separate' ? 'test/fixtures/numbers.ts' : 'src/test-support/fixtures/numbers.ts';
    const testGlob = layout === 'separate' ? 'test/**/*.test.ts' : 'src/**/*.test.ts';
    const supportGlobs = layout === 'separate' ? ['test/helpers/**', 'test/fixtures/**'] : ['src/test-support/**'];
    const files = {
      'package.json': JSON.stringify({ name: `probe-${layout}`, private: true, type: 'module', devDependencies: { vitest: '5.0.3' }, scripts: { test: 'vitest run', lint: 'eslint src' } }, null, 2) + '\n',
      'vitest.config.ts': `export default { test: { include: ['${testGlob}'] } };\n`,
      'squeal.config.json': JSON.stringify({ coverage: { exclude: ['src/generated/**'] }, complexity: { blocking: false }, lint: { enabled: false } }, null, 2) + '\n',
      'src/math.ts': 'export const twice = (n: number) => n * 2;\n',
      'src/helpers/public.ts': 'export const label = (n: number) => String(n);\n',
      'src/generated/client.ts': '// Existing owner exclusion.\nexport const version = () => 1;\n',
      [helper]: `import { sample } from '${layout === 'separate' ? '../fixtures/numbers' : './fixtures/numbers'}.js';\nexport const input = () => sample;\n`,
      [fixture]: 'export const sample = 3;\n',
      [test]: `import { test, expect } from 'vitest';\nimport { twice } from '${layout === 'separate' ? '../src/math' : './math'}.js';\nimport { input } from '${layout === 'separate' ? './helpers/numbers' : './test-support/numbers'}.js';\ntest('twice', () => expect(twice(input())).toBe(6));\n`,
    };
    for (const [path, text] of Object.entries(files)) put(root, path, text);
    run(root, 'git', ['init', '-q']);
    run(root, 'git', ['add', '--', ...Object.keys(files)]);
    const before = snapshot(root);
    const plan = projectPlan(root);
    const questions = run(root, process.execPath, [cli, 'setup'], 1);
    const checkBefore = JSON.parse(run(root, process.execPath, [cli, 'setup', '--check', '--json']));
    const facts = await readRepoFacts(root as never);
    assert.equal(snapshot(root), before, 'read-only plan/check/questions changed scratch files');
    assert.deepEqual(facts.testFiles.paths, [test]);
    const loadedBefore = loadPolicy(root);
    assert.deepEqual(loadedBefore.problems, []);
    const proposed = JSON.parse(files['squeal.config.json']);
    proposed.coverage.exclude.push(...supportGlobs);
    // Research-only application to the disposable fixture, not project config.
    put(root, 'squeal.config.json', JSON.stringify(proposed, null, 2) + '\n');
    const loadedAfter = loadPolicy(root);
    assert.deepEqual(loadedAfter.problems, []);
    const match = createInputMatcher(loadedAfter.policy.coverage.exclude);
    const rows = Object.keys(files).filter(p => p.endsWith('.ts') && p !== 'vitest.config.ts').map(path => ({ path, estimatedTest: facts.testFiles.paths.includes(path), testPatternMatches: createInputMatcher([testGlob])(path as never), coverageExcluded: match(path as never), widenedTestDirectoryMatches: createInputMatcher([layout === 'separate' ? 'test/**' : 'src/**'])(path as never) }));
    assert.equal(match(helper as never), true);
    assert.equal(match(fixture as never), true);
    assert.equal(match('src/math.ts' as never), false);
    assert.equal(match('src/helpers/public.ts' as never), false);
    assert.equal(match('src/generated/client.ts' as never), true);
    assert.equal(createInputMatcher([testGlob])(helper as never), false);
    const afterHash = snapshot(root);
    const checkAfter = JSON.parse(run(root, process.execPath, [cli, 'setup', '--check', '--json']));
    assert.equal(snapshot(root), afterHash);
    const diff = run(root, 'git', ['diff', '--', 'squeal.config.json']);
    writeFileSync(join(here, `${layout}.diff`), diff);
    results.push({ layout, fixture: files, plan, questionText: questions.replaceAll(root, '<scratch>'), readonlyUnchanged: true, testFiles: facts.testFiles, checkBefore: { problems: checkBefore.config.problems, outdated: checkBefore.outdated }, checkAfter: { problems: checkAfter.config.problems, outdated: checkAfter.outdated }, effectivePolicyBefore: { complexity: loadedBefore.policy.complexity, coverage: loadedBefore.policy.coverage, crap: loadedBefore.policy.crap, lint: loadedBefore.policy.lint }, proposed, rows, validation: 'Static plan and matcher assertions only. No tests, coverage collection, lint or daemon ran.' });
  }
  const output = { version: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version, commit: run(repo, 'git', ['rev-parse', 'HEAD']).trim(), node: process.version, startedAt: new Date(start).toISOString(), elapsedMs: Date.now() - start, cpus: cpus().length, load: loadavg(), expensiveRunsSkipped: true, calls, results };
  writeFileSync(join(here, 'results.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ layouts: results.length, assertions: 'passed', elapsedMs: output.elapsedMs, load: output.load, cpus: output.cpus, calls: calls.length }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
