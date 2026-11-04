// Throwaway bounded execution-width probe. No existing daemon is stopped.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, readdirSync, existsSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(base, '../../../../../..');
const cli = process.argv[2];
if (!cli) throw new Error('Usage: node probe.mjs <absolute squeal.mjs>');
const root = mkdtempSync(join(tmpdir(), 'squeal-issue-146-'));
const out = join(base, 'output');
mkdirSync(out, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(GIT_|VITEST|SQUEAL_|CEZ)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
env.XDG_CONFIG_HOME = join(root, '.config');
const put = (name, text) => { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), text); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function gate(label) {
  const evidence = { label, at: new Date().toISOString(), load: loadavg(), cpus: cpus().length };
  console.log(JSON.stringify(evidence));
  if (evidence.load[0] > evidence.cpus) throw new Error('SKIPPED: load exceeds CPU count');
}
function run(bin, args, label) {
  console.log(JSON.stringify({ command: [bin, ...args], cwd: root, label }));
  return new Promise(resolve => {
    const child = spawn(bin, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => output += x);
    child.stderr.on('data', x => output += x);
    const timer = setTimeout(() => child.kill('SIGTERM'), 70000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      writeFileSync(join(out, `${label}.txt`), output);
      console.log(JSON.stringify({ label, code, signal }));
      resolve({ code, output });
    });
  });
}
const squeal = (args, label) => run(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], label);
put('.gitignore', 'node_modules/\n.config/\nevents.jsonl\n');
put('package.json', JSON.stringify({ name: 'issue-146-probe', private: true, type: 'module' }));
put('squeal.config.json', JSON.stringify({ runner: { tierSize: 4 }, baseline: { onStart: 'lookup-then-run-missing' }, coverage: { enabled: false } }));
put('vitest.config.ts', `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { maxWorkers: 4, fileParallelism: true, pool: 'forks', projects: [
{ extends: true, test: { name: 'a', include: ['test/a*.test.ts'] } },
{ extends: true, test: { name: 'b', include: ['test/b*.test.ts'] } }
] } });\n`);
put('kit.ts', 'export const value = 1;\n');
const paths = [];
for (const project of ['a', 'b']) for (let i = 0; i < 6; i++) {
  const name = `${project}${i}`;
  paths.push(`test/${name}.test.ts`);
  put(`test/${name}.test.ts`, `import { test, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { value } from '../kit';
test('${name}', async () => {
 const log = phase => appendFileSync(new URL('../events.jsonl', import.meta.url), JSON.stringify({ file: '${name}', phase, at: Date.now(), pid: process.pid, worker: process.env.VITEST_POOL_ID }) + '\\n');
 log('start'); await new Promise(r => setTimeout(r, 1500)); expect(value).toBe(1); log('end');
});\n`);
}
symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: root, env });
const eventsPath = join(root, 'events.jsonl');
function summarize(label) {
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map(JSON.parse);
  writeFileSync(join(out, `${label}-events.json`), JSON.stringify(events, null, 2) + '\n');
  let active = 0, peak = 0, total = 0;
  const starts = new Map();
  const durations = [];
  for (const event of events.sort((a, b) => a.at - b.at)) {
    if (event.phase === 'start') { starts.set(event.file, event.at); active++; peak = Math.max(peak, active); }
    else { active--; const ms = event.at - starts.get(event.file); total += ms; durations.push({ file: event.file, ms }); }
  }
  const span = events.at(-1).at - events[0].at;
  console.log(JSON.stringify({ label, files: durations.length, peak, spanMs: span, summedMs: total, effectiveWorkers: total / span, workers: [...new Set(events.map(e => e.worker))], durations }));
}
async function waitFiles() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (existsSync(eventsPath) && readFileSync(eventsPath, 'utf8').split('\n').filter(s => s.includes('"end"')).length >= 12) return;
    await sleep(250);
  }
  throw new Error('12 files did not end within 60 seconds');
}
console.log(JSON.stringify({ root, cli, node: process.version, vitest: JSON.parse(readFileSync(join(repo, 'node_modules/vitest/package.json'), 'utf8')).version }));
gate('parallel control');
await run('pnpm', ['exec', 'vitest', 'run', ...paths, '--reporter=dot'], 'control');
summarize('control');
writeFileSync(eventsPath, '');
gate('Squeal baseline');
const daemon = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let daemonLog = '';
daemon.stdout.on('data', x => daemonLog += x);
daemon.stderr.on('data', x => daemonLog += x);
const ended = new Promise(r => daemon.once('exit', (code, signal) => r({ code, signal })));
try {
  await waitFiles();
  await squeal(['status', '--wait', '10000', ...paths], 'baseline-status');
  summarize('baseline');
  writeFileSync(eventsPath, '');
  gate('Squeal comment edit');
  put('kit.ts', 'export const value = 1;\n// comment-only edit\n');
  await waitFiles();
  await squeal(['status', '--wait', '10000', ...paths], 'edit-status');
  summarize('edit');
  const runs = join(root, '.git/squeal/runs');
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name === 'report.json') {
        const report = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(join(out, `run-${report.runId}.json`), JSON.stringify(report, null, 2) + '\n');
      }
    }
  }
  if (existsSync(runs)) collect(runs);
} finally {
  await squeal(['stop'], 'stop');
  console.log(JSON.stringify({ daemonExit: await Promise.race([ended, sleep(5000).then(() => { daemon.kill('SIGTERM'); return 'SIGTERM sent'; })]) }));
  writeFileSync(join(out, 'daemon.txt'), daemonLog);
  console.log(JSON.stringify({ finalLoad: loadavg() }));
}
