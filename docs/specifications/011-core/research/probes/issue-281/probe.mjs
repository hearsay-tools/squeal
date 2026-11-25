// Throwaway source-level probe. No daemon, socket, store or process is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import vm from 'node:vm';

const refs = process.argv.slice(2);
if (refs.length === 0) refs.push('squeal--v0.1.606', 'squeal--v0.1.627', 'squeal--v0.1.630', 'HEAD');
const load = os.loadavg();
console.log(JSON.stringify({ time: new Date().toISOString(), node: process.version, load, cpus: os.cpus().length }));
if (load[0] > os.cpus().length) throw new Error('Load gate: skip reproduction');

function source(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
}

// Keep each production function verbatim, stripping only TS and its export keyword.
// Their I/O dependencies and clock below are explicit synthetic inputs.
function fn(text, name) {
  const start = text.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, name);
  const next = text.indexOf('\n/**', start);
  const selected = text.slice(start, next < 0 ? undefined : next).replace(/^export /, '');
  return stripTypeScriptTypes(selected, { mode: 'strip' });
}

for (const ref of refs) {
  const start = source(ref, 'src/cli/start.ts');
  const ready = source(ref, 'src/cli/start-ready.ts');
  const findings = source(ref, 'src/core/presence/findings.ts');
  const code = [fn(start, 'finishHandoff'), fn(start, 'stillHeld'), fn(start, 'tokenOf'),
    fn(ready, 'served'), fn(ready, 'registered'), fn(ready, 'spawnedFailed'), fn(findings, 'stoppingOf')].join('\n');
  const sha = execFileSync('git', ['rev-parse', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const version = JSON.parse(source(ref, 'package.json')).version;
  for (const scenario of ['spawn-unavailable', 'successor-exited', 'ordinary-start-exited']) {
    let elapsed = 0;
    let ensures = 0;
    let probes = 0;
    let stdout = '';
    let stderr = '';
    const context = vm.createContext({
      Date: class extends Date { static now() { return 1_000_000 + elapsed; } },
      performance: { now: () => elapsed },
      sleep: async (ms) => { elapsed += ms; },
      probeDaemon: async () => { probes++; return { state: 'absent', code: 'ENOENT' }; },
      recordedDaemon: () => null,
      ensureDaemon: async () => { ensures++; return scenario === 'spawn-unavailable' ? 'unavailable' : 'spawned'; },
      claims: async () => true,
      lockFreed: async () => ({ state: 'free' }),
      squealVersion: () => version,
      SUCCESSOR_LOCK_WAIT_MS: 120_000,
      STATUS_BUSY_TIMEOUT_MS: 1_000,
      statusCommand: () => 'squeal',
      process: { env: {} },
      root: '/synthetic/issue-281',
      stopping: { ping: null, record: { startedAt: 1, token: 'old' }, from: '0.1.606' },
      bounds: { socketMs: 60_000, lockMs: 30_000, busyBoundMs: undefined },
      io: { stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } },
      HANDOFF_BOUND_MS: 130_000,
    });
    vm.runInContext(code, context);
    const expression = scenario === 'ordinary-start-exited'
      ? 'spawnedFailed(root, { pid: 4242, ended: () => true }, io, 30000)'
      : 'finishHandoff(root, undefined, stopping, io, bounds)';
    const exit = await vm.runInContext(expression, context);
    assert.equal(exit, 1);
    assert.equal(stdout, '');
    assert.equal(elapsed, scenario === 'ordinary-start-exited' ? 0 : 90_050);
    assert.equal(ensures, scenario === 'ordinary-start-exited' ? 0 : 1);
    assert.match(stderr, scenario === 'ordinary-start-exited' ? /exited without answering/ : /let go of its lock.*after 90 s/);
    console.log(JSON.stringify({ ref, sha, version, scenario, virtualElapsedMs: elapsed, ensures, probes, exit, stdout, stderr: stderr.trim() }));
  }
  const record = { squealVersion: version, heartbeatAt: 100 };
  const context = vm.createContext({ HANDOFF_BOUND_MS: 130_000 });
  vm.runInContext(fn(findings, 'stoppingOf'), context);
  context.record = record;
  context.facts = { row: () => ({}), claim: () => null, lockFree: () => false, exitNoteAt: () => 100 };
  const held = vm.runInContext('stoppingOf(facts, record, () => true, {state: "down"}, () => null, 200000)', context);
  assert.equal(held.overdue, true);
  context.facts.lockFree = () => true;
  const free = vm.runInContext('stoppingOf(facts, record, () => true, {state: "down"}, () => null, 200000)', context);
  assert.equal(free, null);
  console.log(JSON.stringify({ ref, scenario: 'marked-shutdown-presence', held, free }));
}
