// Throwaway research probe. Opens only databases in its own temporary repository.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const cli = resolve(process.argv[2]);
const initialLoad = loadavg()[0];
console.log(JSON.stringify({ started: new Date().toISOString(), node: process.version,
  cpus: cpus().length, initialLoad, cli,
  version: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim() }));
if (initialLoad > 24) { console.log('SKIP: one-minute load exceeds 24 CPUs'); process.exit(0); }
const scratch = mkdtempSync(join(tmpdir(), 'issue-202-'));
const root = join(scratch, 'repo');
const childEnv = { PATH: process.env.PATH, HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp') };
for (const dir of [root, childEnv.HOME, childEnv.TMPDIR, join(root, 'src'), join(root, 'test')]) mkdirSync(dir, { recursive: true });
const source = join(root, 'src/math.mjs');
const args = [cli, 'code', '--base', 'main', '--json', '--timeout', '1800'];
let held;

async function gate(label, releaseAfterReport = false) {
  const started = performance.now();
  let reportAtMs = null;
  let releaseAtMs = null;
  let stdout = '';
  let stderr = '';
  let releaseTimer;
  const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = setTimeout(() => child.kill('SIGTERM'), 45_000);
  child.stdout.on('data', chunk => {
    stdout += chunk;
    if (reportAtMs !== null) return;
    try { JSON.parse(stdout); } catch { return; }
    reportAtMs = performance.now() - started;
    if (releaseAfterReport) releaseTimer = setTimeout(() => {
      held.exec('ROLLBACK'); held.close(); held = undefined;
      releaseAtMs = performance.now() - started;
    }, 2000);
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  }).finally(() => { clearTimeout(deadline); clearTimeout(releaseTimer); });
  const returnAtMs = performance.now() - started;
  const report = JSON.parse(stdout);
  const result = { label, command: [process.execPath, ...args], reportAtMs, returnAtMs,
    reportToReturnMs: returnAtMs - reportAtMs, releaseAtMs, exit,
    format: report.format, verdict: report.verdict, from: report.runs[0]?.from ?? {}, stderr };
  console.log(JSON.stringify(result));
  assert.equal(report.verdict, 'pass'); assert.equal(exit.code, 0); assert.notEqual(reportAtMs, null);
  return result;
}

try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'issue-202', private: true, type: 'module' }));
  writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({ complexity: { enabled: true }, coverage: { enabled: true }, nodeTest: [{ name: 't', include: ['test/*.test.mjs'] }] }));
  writeFileSync(source, 'export function double(x) {\n  return x * 2;\n}\n');
  writeFileSync(join(root, 'test/math.test.mjs'), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../src/math.mjs";\ntest("doubles", () => assert.equal(double(2), 4));\n');
  const git = args => execFileSync('git', args, { cwd: root, env: childEnv, stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'user.name=Research probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  writeFileSync(source, 'export function double(x) {\n  return x + x;\n}\n');
  await gate('unlocked');
  const reused = await gate('unlocked reuse');
  assert.deepEqual(Object.values(reused.from), ['store']);
  const nextLoad = loadavg()[0];
  console.log(JSON.stringify({ beforeHeldLoad: nextLoad }));
  if (nextLoad > 24) { console.log('SKIP held case: one-minute load exceeds 24 CPUs'); }
  else {
    writeFileSync(source, 'export function double(x) {\n  return x + x + 0;\n}\n');
    held = new DatabaseSync(join(root, '.git/squeal/store.sqlite'));
    held.exec('BEGIN IMMEDIATE');
    const delayed = await gate('held until 2 s after complete JSON', true);
    assert.match(delayed.stderr, /the store is busy/);
    assert.match(delayed.stderr, /completed test file kept/);
    assert.ok(delayed.reportToReturnMs >= 1900);
    assert.ok(delayed.returnAtMs >= delayed.releaseAtMs);
    const retained = await gate('short-lock reuse');
    assert.deepEqual(Object.values(retained.from), ['store']);
  }
  console.log(JSON.stringify({ result: 'PASS', finalLoad: loadavg()[0] }));
} finally {
  if (held) { held.exec('ROLLBACK'); held.close(); }
  rmSync(scratch, { recursive: true, force: true });
}
