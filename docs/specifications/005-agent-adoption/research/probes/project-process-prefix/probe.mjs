// Throwaway Linux probe. Imports product readers; starts no Squeal daemon.
import assert from 'node:assert/strict';
import childProcess, { spawn, fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, existsSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProcSource } from '../../../../../../src/core/ps/proc.ts';
import { ensureDaemonProcess } from '../../../../../../src/core/daemon/ensure.ts';
import { discover } from '../../../../../../src/core/ps/discover.ts';
import { keepVersion } from '../../../../../../src/harness/shared/version-copies.ts';
import { worktreeIdFor, resolveCommonDir } from '../../../../../../src/core/fs/git-layout.ts';

assert.equal(process.platform, 'linux');
const repo = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'squeal-prefix-'));
const project = join(scratch, 'project with spaces');
mkdirSync(project, { recursive: true });
run('git', ['init', '-q', project]);
run('git', ['-C', project, '-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', '-c', 'maintenance.auto=false', 'commit', '--allow-empty', '--no-gpg-sign', '-qm', 'fixture']);
const linked = join(scratch, 'linked worktree');
run('git', ['-C', project, 'worktree', 'add', '-q', '--detach', linked]);
const data = join(scratch, 'plugin data');
const results = [];
const snapCode = `({pid:process.pid,argv:[...process.argv],argv0:process.argv0,execPath:process.execPath,execArgv:[...process.execArgv],title:process.title,cmdline:readFileSync('/proc/self/cmdline','utf8').split('\\0').filter(Boolean),comm:readFileSync('/proc/self/comm','utf8').trim()})`;
const idle = `import {readFileSync} from 'node:fs'; console.log(JSON.stringify(${snapCode})); setTimeout(()=>{},15000);`;
function makeVersion(version) {
  const root = join(scratch, 'source', version);
  mkdirSync(join(root, '.codex-plugin'), { recursive: true });
  mkdirSync(join(root, 'dist/cli'), { recursive: true });
  writeFileSync(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'dist/cli/squeal.mjs'), idle);
  assert.ok(keepVersion({ root, data, version }));
  const saved = join(data, 'versions', version);
  utimesSync(saved, 1, 1); // Older than the 24-hour grace period.
  return join(saved, 'dist/cli/squeal.mjs');
}
async function ready(child) {
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes('\n')) return JSON.parse(output.split('\n')[0]);
  }
  throw new Error('child exited before reporting');
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, ...options });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result;
}
try {
  const script = makeVersion('0.1.1');
  makeVersion('0.1.2');
  for (const mode of ['spawn-baseline', 'spawn-prefix', 'spawn-prefix-flags', 'linked-prefix', 'fork-prefix']) {
    const selectedRoot = mode === 'linked-prefix' ? linked : project;
    const args = ['daemon', selectedRoot, '--await-lock', '60000'];
    const flags = mode === 'spawn-prefix-flags' ? ['--disable-warning=ExperimentalWarning'] : [];
    const prefix = mode === 'spawn-baseline' ? process.execPath : 'squeal cezarion@work-1 daemon';
    const child = mode === 'fork-prefix'
      ? fork(script, args, { argv0: prefix, execArgv: [], silent: true })
      : spawn(process.execPath, [...flags, script, ...args], { argv0: prefix, stdio: ['ignore', 'pipe', 'inherit'] });
    const closed = once(child, 'close');
    try {
      const js = await ready(child);
      assert.deepEqual(js.argv, [process.execPath, script, ...args]);
      assert.deepEqual(js.cmdline, [prefix, ...flags, script, ...args]);
      assert.deepEqual(js.execArgv, flags);
      assert.equal(js.argv0, prefix);
      assert.equal(readlinkSync(`/proc/${child.pid}/exe`), process.execPath);
      const source = createProcSource();
      const found = discover(source, source.processTable([child.pid]), {
        uid: process.getuid(), runtimeDir: null, tempDir: scratch,
      }).daemons;
      assert.equal(found.length, 1);
      assert.equal(found[0].root, selectedRoot);
      assert.equal(found[0].script, script);
      assert.equal(found[0].worktreeId, worktreeIdFor(selectedRoot));
      assert.equal(found[0].commonDir, resolveCommonDir(project));
      assert.equal(found[0].lockWaitMs, 60000);
      const ps = run('ps', ['-ww', '-p', String(child.pid), '-o', 'args=']).stdout.trim();
      assert.ok(ps.startsWith(prefix + ' '));
      results.push({ mode, js, ps, discovery: { count: found.length, root: found[0].root, worktreeId: found[0].worktreeId, lockWaitMs: found[0].lockWaitMs } });
      if (mode === 'fork-prefix') {
        makeVersion('0.1.3'); // Executes the actual ps-based prune function.
        assert.ok(existsSync(script), 'active oldest version removed');
        results.push({ retention: 'active 0.1.1 kept across 0.1.2 and 0.1.3, all older than 24h' });
      }
    } finally { child.kill(); await closed; }
  }
  // Exercise the actual ensure spawn seam; only add argv0 at the boundary.
  // Its target is the idle fixture, never the real CLI.
  const originalSpawn = childProcess.spawn;
  let ensuredChild;
  childProcess.spawn = function(command, args, options) {
    if (args?.[0] === script) {
      ensuredChild = originalSpawn(command, args, { ...options, argv0: 'squeal cezarion@linked daemon' });
      return ensuredChild;
    }
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
  try {
    const ensured = await ensureDaemonProcess(linked, { cli: script, awaitLockMs: 60000 });
    assert.equal(ensured.result, 'spawned');
    await delay(100);
    const source = createProcSource();
    const args = source.cmdline(ensured.pid);
    assert.deepEqual(args, ['squeal cezarion@linked daemon', script, 'daemon', linked, '--await-lock', '60000']);
    const found = discover(source, source.processTable([ensured.pid]), { uid: process.getuid(), runtimeDir: null, tempDir: scratch }).daemons;
    assert.equal(found.length, 1);
    assert.equal(found[0].root, linked);
    results.push({ mode: 'actual ensureDaemonProcess with diagnostic argv0 option', cmdline: args, discovered: true });
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    if (ensuredChild) { ensuredChild.ref(); const closed = once(ensuredChild, 'close'); ensuredChild.kill(); await closed; }
  }
  makeVersion('0.1.4');
  assert.equal(existsSync(script), false, 'inactive oldest version retained');
  results.push({ retention: 'inactive 0.1.1 removed when 0.1.4 was made' });

  // One node:test file: inspect its isolated child, not just its launcher.
  const nodeFile = join(project, 'tiny.test.mjs');
  const nodeOut = join(scratch, 'node-result.json');
  writeFileSync(nodeFile, `import {test} from 'node:test'; import {readFileSync,writeFileSync} from 'node:fs'; test('snapshot',()=>writeFileSync(${JSON.stringify(nodeOut)},JSON.stringify(${snapCode})));`);
  run(process.execPath, ['--test', nodeFile], { argv0: 'squeal cezarion node-test' });
  const nodeResult = JSON.parse(readFileSync(nodeOut));
  assert.equal(nodeResult.argv0, process.execPath);
  results.push({ runner: 'node:test', child: nodeResult, inheritsPrefix: false });

  // One Vitest file, one worker. A temporary root prevents repo-suite discovery.
  symlinkSync(join(repo, 'node_modules'), join(project, 'node_modules'), 'dir');
  const vitestOut = join(scratch, 'vitest-result.json');
  const vitestFile = join(project, 'tiny.vitest.mjs');
  writeFileSync(vitestFile, `import {test} from 'vitest'; import {readFileSync,writeFileSync} from 'node:fs'; test('snapshot',()=>writeFileSync(${JSON.stringify(vitestOut)},JSON.stringify(${snapCode})));`);
  const config = join(project, 'vitest.config.mjs');
  writeFileSync(config, `export default {test:{include:['tiny.vitest.mjs'],pool:'forks',maxWorkers:1}};`);
  run(process.execPath, [join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--root', project, '--config', config], { argv0: 'squeal cezarion vitest' });
  const vitestResult = JSON.parse(readFileSync(vitestOut));
  assert.equal(vitestResult.argv0, process.execPath);
  results.push({ runner: 'vitest 5.0.3 forks', child: vitestResult, inheritsPrefix: false });
  // Diagnostic only: supply argv0 at Vitest's actual fork to test title overwrite.
  // This global patch is NOT an implementation recommendation.
  const preload = join(scratch, 'prefix-fork.cjs');
  writeFileSync(preload, `const cp=require('node:child_process'); const original=cp.fork; cp.fork=function(entry,args,options){return original.call(this,entry,args,String(entry).includes('/vitest/dist/workers/')?{...options,argv0:'squeal cezarion vitest-worker'}:options)}; require('node:module').syncBuiltinESMExports();`);
  run(process.execPath, ['--require', preload, join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--root', project, '--config', config]);
  const namedWorker = JSON.parse(readFileSync(vitestOut));
  assert.equal(namedWorker.argv0, 'squeal cezarion vitest-worker');
  assert.equal(namedWorker.cmdline[0], namedWorker.argv0);
  assert.ok(namedWorker.cmdline.some(arg => arg.endsWith('/vitest/dist/workers/forks.js')));
  results.push({ runner: 'vitest 5.0.3 explicit fork argv0 (diagnostic patch)', child: namedWorker, overwritesPrefix: false });
  const pythonCode = 'import sys,json; print(json.dumps(dict(version=sys.version.split()[0], executable=sys.executable, prefix=sys.prefix)))';
  const pythonBase = JSON.parse(run('python3', ['-c', pythonCode]).stdout);
  const pythonNamed = JSON.parse(run('python3', ['-c', pythonCode], { argv0: 'squeal cezarion pytest' }).stdout);
  assert.notEqual(pythonNamed.executable, pythonBase.executable);
  results.push({ runner: 'python3', baseline: pythonBase, prefixed: pythonNamed });
  console.log(JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
