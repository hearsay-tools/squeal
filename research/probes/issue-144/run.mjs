// Throwaway issue-144 probe. No dependencies or product edits.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const cli = resolve(process.argv[2] ?? 'plugins/claude-code/dist/cli/squeal.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'sq-issue-144-'));
const output = { utc: new Date().toISOString(), node: process.version, cli, scratch, cases: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
function gate() {
  const info = { load1: loadavg()[0], cpus: cpus().length };
  if (info.load1 > info.cpus) throw new Error(`Skipped live probe: ${JSON.stringify(info)}`);
  return info;
}
function run(cwd, env, command, args) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 45000 });
  return { command: [command, ...args], exit: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message };
}
const source = `export function showHelp() {
  return new Promise(function helpPromise(resolve) {
    process.stdout.write('usage: probe --help\\n', function onHelpWritten() {
      process.stderr.write('callback-ran\\n');
      resolve();
    });
  });
}
`;
for (const name of ['child-only', 'child-imported', 'in-process']) {
  const load = gate();
  const root = join(scratch, name);
  for (const dir of ['scripts', 'test', 'runtime', 'home', 'config']) mkdirSync(join(root, dir), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'), XDG_CONFIG_HOME: join(root, 'config') };
  const files = {
    '.gitignore': 'runtime/\nhome/\nconfig/\nraw/\n',
    'package.json': JSON.stringify({ name: `issue-144-${name}`, private: true, type: 'module' }),
    'squeal.config.json': JSON.stringify({ baseline: { onStart: 'lookup-then-run-missing' }, nodeTest: [{ name: 'probe', cwd: '.', node: process.execPath, include: ['test/*.test.mjs'] }], complexity: { enabled: true, include: ['scripts/help.mjs'] }, coverage: { enabled: true, exclude: ['test/**', 'scripts/entry.mjs'] }, crap: { enabled: true }, lint: { enabled: false } }),
    'scripts/help.mjs': source,
    'scripts/entry.mjs': `import { showHelp } from './help.mjs';\nawait showHelp();\n`,
    'test/help.test.mjs': `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\n${name !== 'child-only' ? "import { showHelp } from '../scripts/help.mjs';" : ''}\ntest('help callback runs', async () => {\n${name === 'in-process' ? '  await showHelp();' : `  const child = spawnSync(process.execPath, ['scripts/entry.mjs', '--help'], { encoding: 'utf8' });\n  assert.equal(child.status, 0);\n  assert.equal(child.stdout, 'usage: probe --help\\n');\n  assert.equal(child.stderr, 'callback-ran\\n');`}\n});\n`,
  };
  for (const [path, body] of Object.entries(files)) writeFileSync(join(root, path), body);
  const commands = [];
  for (const args of [['init', '-q'], ['add', '.gitignore', 'package.json', 'squeal.config.json', 'scripts', 'test'], ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']]) {
    const r = run(root, env, 'git', args); if (r.exit !== 0) throw new Error(JSON.stringify(r));
  }
  commands.push(run(root, env, process.execPath, [cli, '--version']));
  gate();
  const daemon = spawn(process.execPath, [cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let daemonLog = ''; daemon.stdout.on('data', b => daemonLog += b); daemon.stderr.on('data', b => daemonLog += b);
  try {
    await pause(1500);
    commands.push(run(root, env, process.execPath, [cli, 'status', '--wait', '30000', 'test/help.test.mjs']));
    let code;
    for (let i = 0; i < 20; i++) {
      code = run(root, env, process.execPath, [cli, 'code', 'scripts/help.mjs']);
      if (code.stdout.includes('onHelpWritten') && /CRAP [0-9]/.test(code.stdout) && !code.stdout.includes('pending')) break;
      await pause(1000);
    }
    commands.push(code);
    commands.push(run(root, env, process.execPath, [cli, 'code', 'scripts/help.mjs', '--json']));
    commands.push(run(root, env, process.execPath, [cli, 'code']));
  } finally {
    const ended = once(daemon, 'exit'); daemon.kill('SIGTERM');
    await Promise.race([ended, pause(5000)]);
    if (daemon.exitCode === null && daemon.signalCode === null) { daemon.kill('SIGKILL'); await ended; }
  }
  let childCoverage;
  if (name === 'child-only') {
    gate();
    const raw = join(root, 'raw'); mkdirSync(raw);
    commands.push(run(root, { ...env, NODE_V8_COVERAGE: raw }, process.execPath, ['--test', 'test/help.test.mjs']));
    childCoverage = readdirSync(raw).flatMap(file => JSON.parse(readFileSync(join(raw, file), 'utf8')).result.filter(script => script.url.endsWith('/scripts/help.mjs')).map(script => ({ url: script.url, functions: script.functions.map(fn => ({ name: fn.functionName, counts: fn.ranges.map(r => r.count) })) })));
  }
  output.cases.push({ name, load, commands, childCoverage, daemonLog });
  console.log(JSON.stringify({ case: name, load, results: commands.map(c => ({ command: c.command.slice(1), exit: c.exit, stdout: c.stdout })), childCoverage }));
}
writeFileSync(process.argv[3] ?? join(scratch, 'results.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Scratch retained: ${scratch}`);
