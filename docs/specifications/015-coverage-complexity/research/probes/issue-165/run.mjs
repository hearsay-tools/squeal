// Throwaway issue-165 research probe. Uses installed dependencies and the committed CLI.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
const repo = process.cwd();
const cli = resolve('plugins/claude-code/dist/cli/squeal.mjs');
const destination = resolve('docs/specifications/015-coverage-complexity/research/probes/issue-165/results.json');
const scratch = mkdtempSync(join(tmpdir(), 'sq-issue-165-'));
const output = { utc: new Date().toISOString(), node: process.version, cli, scratch,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), cases: [] };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function gate() {
  const info = { utc: new Date().toISOString(), load1: loadavg()[0], cpus: cpus().length };
  if (info.load1 > info.cpus) throw new Error(`Skipped live probe: ${JSON.stringify(info)}`);
  return info;
}
function run(cwd, env, command, args) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 45000 });
  return { command: [command, ...args], exit: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message };
}
const python = `def classify(n):
    if n < 0:
        return "negative"
    if n == 0:
        return "zero"
    return "positive"


def summarize(rows, strict=False):
    total = 0
    for row in rows:
        if row is None:
            continue
        if strict and row < 0:
            raise ValueError("negative row")
        if row > 100 or row < -100:
            total += 100
        else:
            total += row
    return total
`;
const pyTest = `from bench.stats import classify, summarize


def test_classify():
    assert classify(-1) == "negative"
    assert classify(0) == "zero"
    assert classify(2) == "positive"


def test_summarize():
    assert summarize([1, None, 200]) == 101
`;
for (const name of ['no-python-runner', 'coverage-exclude']) {
  const load = gate();
  const root = join(scratch, name);
  for (const dir of ['bench', 'src', 'test', 'runtime', 'home', 'config']) mkdirSync(join(root, dir), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'), XDG_CONFIG_HOME: join(root, 'config') };
  const files = {
    '.gitignore': 'runtime/\nhome/\nconfig/\nnode_modules/\n',
    'package.json': JSON.stringify({ name: `issue-165-${name}`, private: true, type: 'module' }),
    'squeal.config.json': JSON.stringify({ baseline: { onStart: 'lookup-then-run-missing' },
      nodeTest: [{ name: 'probe', cwd: '.', node: process.execPath, include: ['test/*.test.mjs'] }],
      complexity: { enabled: true },
      coverage: { enabled: true, exclude: name === 'coverage-exclude' ? ['bench/**'] : [] },
      crap: { enabled: true }, lint: { enabled: false } }),
    'src/sign.mjs': 'export function sign(n) {\n  if (n < 0) return -1;\n  if (n === 0) return 0;\n  return 1;\n}\n',
    'test/sign.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sign } from '../src/sign.mjs';\ntest('sign', () => { assert.equal(sign(-2), -1); assert.equal(sign(0), 0); assert.equal(sign(3), 1); });\n",
    'bench/__init__.py': '',
    'bench/stats.py': python,
    'bench/test_stats.py': pyTest,
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']]) {
    const r = run(root, env, 'git', args); if (r.exit !== 0) throw new Error(JSON.stringify(r));
  }
  const commands = [run(root, env, process.execPath, [cli, '--version'])];
  const launchLoad = gate();
  const daemon = spawn(process.execPath, [cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let daemonLog = ''; daemon.stdout.on('data', (b) => (daemonLog += b)); daemon.stderr.on('data', (b) => (daemonLog += b));
  try {
    await pause(1500);
    commands.push(run(root, env, process.execPath, [cli, 'status', '--wait', '30000', 'test/sign.test.mjs']));
    let code;
    for (let i = 0; i < 25; i++) {
      code = run(root, env, process.execPath, [cli, 'code', 'bench/stats.py']);
      if (code.stdout.includes('summarize') && !/pending|counting/.test(code.stdout)) break;
      await pause(1000);
    }
    commands.push(code);
    commands.push(run(root, env, process.execPath, [cli, 'code', 'bench/stats.py', '--json']));
    commands.push(run(root, env, process.execPath, [cli, 'code', 'src/sign.mjs']));
    commands.push(run(root, env, process.execPath, [cli, 'code']));
    commands.push(run(root, env, process.execPath, [cli, 'status']));
  } finally {
    const ended = once(daemon, 'exit'); daemon.kill('SIGTERM');
    await Promise.race([ended, pause(5000)]);
    if (daemon.exitCode === null && daemon.signalCode === null) { daemon.kill('SIGKILL'); await ended; }
  }
  output.cases.push({ name, load, launchLoad, files, commands, daemonLog, daemonExit: daemon.exitCode, daemonSignal: daemon.signalCode });
  writeFileSync(destination, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ name, load, commands: commands.map((c) => ({ command: c.command.slice(1), exit: c.exit, stdout: c.stdout, stderr: c.stderr })) }, null, 1));
}
console.log(`Scratch retained: ${scratch}`);
