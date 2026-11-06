// Throwaway issue-155 research probe. Uses the installed 0.1.407 plugin CLI and installed Vitest.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { once } from 'node:events';
const repo = process.cwd();
const cli = process.env.PROBE_CLI ?? join(homedir(), '.claude/plugins/cache/hearsay/squeal/0.1.407/dist/cli/squeal.mjs');
const destination = resolve(process.argv[2] ?? 'docs/specifications/015-coverage-complexity/research/probes/issue-155/results.json');
const scratch = mkdtempSync(join(tmpdir(), 'sq-issue-155-'));
const output = { settle: Boolean(process.env.PROBE_SETTLE), slow: Boolean(process.env.PROBE_SLOW), inputs: Boolean(process.env.PROBE_INPUTS), coverageConfig: process.env.PROBE_COVERAGE ?? 'enabled', utc: new Date().toISOString(), node: process.version, cli,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version, phases: [] };
const pause = ms => new Promise(done => setTimeout(done, ms));
function gate() {
  const info = { utc: new Date().toISOString(), load1: loadavg()[0], cpus: cpus().length };
  if (info.load1 > info.cpus) throw new Error(`Skipped live probe: ${JSON.stringify(info)}`);
  return info;
}
function run(cwd, env, command, args) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 70000 });
  return { command: [command, ...args].map(a => a.replace(scratch, '<scratch>')), exit: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message };
}
const root = join(scratch, 'repo');
for (const dir of ['runtime', 'home', 'config']) mkdirSync(join(root, dir), { recursive: true });
symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'), XDG_CONFIG_HOME: join(root, 'config') };
const write = files => { for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), body); } };
const sources = ['src/api.ts', 'src/helper.testkit.ts', '.github/scripts/label.cjs'];
// Case A: object-property arrows (vitest). Case B: *.testkit.ts helper (vitest). Case C: node:test .cjs.
const initial = {
  '.gitignore': 'runtime/\nhome/\nconfig/\nnode_modules/\n',
  'package.json': JSON.stringify({ name: 'issue-155', private: true, type: 'module' }),
  'vitest.config.mjs': `export default { test: { include: ['src/**/*.test.ts'], maxWorkers: 1 } };\n`,
  'squeal.config.json': JSON.stringify({ baseline: { onStart: 'lookup-then-run-missing' },
    nodeTest: [{ name: 'scripts', cwd: '.', node: process.execPath, include: ['.github/scripts/*.test.cjs'] }],
    ...(process.env.PROBE_INPUTS ? { inputs: { 'src/lint.test.ts': ['src/**/*.ts'], '.github/scripts/*.test.cjs': ['.github/scripts/**'] } } : {}),
    ...(process.env.PROBE_SLOW ? { slow: { include: ['src/**/*.e2e.test.ts'], maxWorkers: 1, maxParallel: 1 } } : {}),
    complexity: { enabled: true }, ...(process.env.PROBE_COVERAGE === 'absent' ? {} : { coverage: { enabled: true }, crap: { enabled: true } }), lint: { enabled: false } }),
  'src/api.ts': `export function plain(n: number): number {\n  return n > 0 ? n : -n;\n}\nexport const api = {\n  double: (n: number): number => (n > 1 ? n * 2 : n),\n};\n`,
  'src/api.test.ts': `import { test, expect } from 'vitest';\nimport { plain, api } from './api';\nimport { makeCase } from './helper.testkit';\ntest('api', () => { expect(plain(-2)).toBe(2); expect(api.double(3)).toBe(6); expect(makeCase(1).n).toBe(1); });\n`,
  'src/helper.testkit.ts': `export function makeCase(n: number): { n: number } {\n  if (n < 0) return { n: 0 };\n  return { n };\n}\n`,
  '.github/scripts/label.cjs': `function pick(labels) {\n  if (!labels.length) return null;\n  return labels[0];\n}\nmodule.exports = { pick, fmt: (s) => (s ? '#' + s : '') };\n`,
  ...(process.env.PROBE_SLOW ? { 'src/api.e2e.test.ts': `import { test, expect } from 'vitest';\nimport { plain } from './api';\ntest('slow tier loader', () => { expect(plain(1)).toBe(1); });\n` } : {}),
  ...(process.env.PROBE_INPUTS ? {
    'src/lint.test.ts': `import { test, expect } from 'vitest';\nimport { readFileSync } from 'node:fs';\ntest('reads sources as text', () => { expect(readFileSync('src/api.ts', 'utf8')).toMatch(/plain/); });\n`,
    '.github/scripts/other.test.cjs': `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { readFileSync } = require('node:fs');\ntest('reads script text', () => { assert.match(readFileSync(__dirname + '/label.cjs', 'utf8'), /pick/); });\n`,
  } : {}),
  '.github/scripts/label.test.cjs': `const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { pick, fmt } = require('./label.cjs');\ntest('pick', () => { assert.equal(pick(['a']), 'a'); assert.equal(fmt('x'), '#x'); });\n`,
};
// Edit phase: new object-property arrow and new testkit function, each called by the existing test file.
const edit = {
  'src/api.ts': initial['src/api.ts'].replace('};\n', `  triple: (n: number): number => (n > 1 ? n * 3 : n),\n};\n`),
  'src/api.test.ts': initial['src/api.test.ts'].replace("expect(makeCase(1).n).toBe(1);", "expect(makeCase(1).n).toBe(1); expect(api.triple(2)).toBe(6); expect(makeOther(2)).toBe(3);").replace("import { makeCase }", "import { makeCase, makeOther }"),
  'src/helper.testkit.ts': initial['src/helper.testkit.ts'] + `export const makeOther = (n: number): number => (n > 1 ? n + 1 : n);\n`,
  '.github/scripts/label.cjs': initial['.github/scripts/label.cjs'].replace('module.exports = { pick,', "function last(labels) {\n  return labels.length ? labels[labels.length - 1] : null;\n}\nmodule.exports = { pick, last,"),
  '.github/scripts/label.test.cjs': initial['.github/scripts/label.test.cjs'].replace("const { pick, fmt }", "const { pick, last, fmt }").replace("assert.equal(fmt('x'), '#x');", "assert.equal(fmt('x'), '#x'); assert.equal(last(['a','b']), 'b');"),
};
write(initial);
for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']]) {
  const r = run(root, env, 'git', args); if (r.exit !== 0) throw new Error(JSON.stringify(r));
}
output.version = run(root, env, process.execPath, [cli, '--version']);
const launchLoad = gate();
const daemon = spawn(process.execPath, [cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let daemonLog = ''; daemon.stdout.on('data', b => daemonLog += b); daemon.stderr.on('data', b => daemonLog += b);
async function observe(phase) {
  const load = gate(); const commands = [];
  commands.push(run(root, env, process.execPath, [cli, 'status', '--wait', '60000', 'src/api.test.ts', '.github/scripts/label.test.cjs']));
  let code;
  for (let i = 0; i < 50; i++) {
    code = run(root, env, process.execPath, [cli, 'code', ...sources]);
    if (!/pending|waits/.test(code.stdout)) break;
    await pause(1000);
  }
  commands.push(code);
  commands.push(run(root, env, process.execPath, [cli, 'code', ...sources, '--json']));
  commands.push(run(root, env, process.execPath, [cli, 'status', '--json']));
  commands.push(run(root, env, process.execPath, [cli, 'status']));
  if (phase === 'after-edit' && process.env.PROBE_SETTLE) {
    // Poll until every new function has a CRAP value, up to 60 s, recording when each read happened.
    const started = Date.now(); const reads = [];
    for (;;) {
      const r = run(root, env, process.execPath, [cli, 'code', ...sources]);
      const st = run(root, env, process.execPath, [cli, 'status']);
      reads.push({ ms: Date.now() - started, code: r.stdout, status: st.stdout });
      if (/triple .*CRAP/.test(r.stdout) || Date.now() - started > 60000) break;
      await pause(2000);
    }
    commands.push({ settle: reads });
  }
  output.phases.push({ phase, load, commands });
  writeFileSync(destination, JSON.stringify({ ...output, launchLoad, daemonLog }, null, 2) + '\n');
  console.log(`== ${phase} load ${JSON.stringify(load)}`);
  for (const c of commands.slice(0, 2)) console.log(`$ ${c.command.slice(1).join(' ')}\nexit ${c.exit}\n${c.stdout}${c.stderr}`);
}
try {
  await pause(1500);
  await observe('initial');
  write(edit);
  await pause(2500);
  await observe('after-edit');
} finally {
  const ended = once(daemon, 'exit'); daemon.kill('SIGTERM');
  await Promise.race([ended, pause(5000)]);
  if (daemon.exitCode === null && daemon.signalCode === null) { daemon.kill('SIGKILL'); await ended; }
}
writeFileSync(destination, JSON.stringify({ ...output, launchLoad, daemonLog: daemonLog.replaceAll(scratch, '<scratch>'), daemonExit: daemon.exitCode, daemonSignal: daemon.signalCode }, null, 2) + '\n');
console.log(`Scratch retained: ${scratch}`);
