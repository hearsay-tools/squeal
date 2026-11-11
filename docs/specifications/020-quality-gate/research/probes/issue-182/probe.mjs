// Throwaway research fixture. Run from the Squeal checkout; no install needed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = process.argv[2];
if (!runtime) throw new Error('usage: node probe.mjs /absolute/runtime/dist/cli/squeal.mjs');
const output = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'squeal-issue-182-'));
const write = (path, content) => writeFileSync(join(root, path), content);
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
};
const baseTest = `import { test, expect } from 'vitest';\ntest('small', () => { expect(1 + 1).toBe(2); });\n`;
try {
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  write('.gitignore', 'node_modules/\n');
  write('package.json', JSON.stringify({ type: 'module', devDependencies: { vitest: '5.0.3' } }));
  write('squeal.config.json', JSON.stringify({ coverage: { exclude: ['**/*.test.ts'] } }));
  write('vitest.config.ts', `export default { test: { include: ['small.test.ts'], maxWorkers: 1, globalSetup: ['./setup.mjs'] } };\n`);
  write('setup.mjs', `import { execFileSync } from 'node:child_process';\nexport default function setup() { if (process.env.ISSUE182_QUIET === '1') return; execFileSync(process.execPath, ['./launcher.mjs'], { stdio: 'inherit' }); }\n`);
  write('launcher.mjs', `process.stdout.write('TEST_ENV_STATUS=running\\nTEST_ENV_BASE_URL=http://127.0.0.1:54227\\nTEST_ENV_DESCRIPTOR=.ai/qa/test-env.json\\nTEST_ENV_REUSED=0\\nBROWSER_PROVIDER=agent-browser\\nBROWSER_INSTALLED=1\\n');\nprocess.stderr.write('[test-env] synthetic launcher only; no server or browser started\\n');\n`);
  write('small.test.ts', baseTest);
  git('init', '-q', '-b', 'main');
  git('add', '.gitignore', 'package.json', 'squeal.config.json', 'vitest.config.ts', 'setup.mjs', 'launcher.mjs', 'small.test.ts');
  git('-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture base');
  const observations = [];
  for (const mode of ['unchanged', 'changed', 'changed-quiet']) {
    if (mode !== 'unchanged') write('small.test.ts', baseTest.replace('1 + 1', '2 + 0'));
    const load = loadavg()[0];
    const cpuCount = cpus().length;
    const availableCpuCount = Number(spawnSync('nproc', [], { encoding: 'utf8' }).stdout.trim());
    const gateCpuCount = Math.min(cpuCount, availableCpuCount || cpuCount);
    const observation = { mode, at: new Date().toISOString(), load, cpuCount, availableCpuCount, root };
    if (load > gateCpuCount) {
      observations.push({ ...observation, skipped: 'one-minute load above CPU count' });
      continue;
    }
    const args = ['--disable-warning=ExperimentalWarning', runtime, 'code', '--base', 'main', '--json', '--timeout', '30'];
    const started = performance.now();
    const run = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ISSUE182_QUIET: mode === 'changed-quiet' ? '1' : '0' }, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
    writeFileSync(join(output, `${mode}.stdout.txt`), run.stdout ?? '');
    writeFileSync(join(output, `${mode}.stderr.txt`), run.stderr ?? '');
    let parsed = false;
    let parseError;
    try { JSON.parse(run.stdout); parsed = true; } catch (error) { parseError = error.message; }
    const start = run.stdout.indexOf('{');
    let suffix;
    try { suffix = JSON.parse(run.stdout.slice(start)); } catch {}
    observations.push({ ...observation, command: [process.execPath, ...args], envOverride: { ISSUE182_QUIET: mode === 'changed-quiet' ? '1' : '0' }, elapsedMs: Math.round(performance.now() - started), exit: run.status, signal: run.signal, error: run.error?.message, stdoutBytes: Buffer.byteLength(run.stdout), stderrBytes: Buffer.byteLength(run.stderr), parsed, parseError, prefixBytes: start, report: suffix && { format: suffix.format, versions: suffix.versions, verdict: suffix.verdict, runs: suffix.runs } });
  }
  writeFileSync(join(output, 'observations.json'), JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify(observations, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
