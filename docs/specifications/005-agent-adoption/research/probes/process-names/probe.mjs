// Throwaway Linux process-display experiment. No Squeal runtime is started.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.equal(process.platform, 'linux', 'This probe requires Linux /proc');
const root = mkdtempSync(join(tmpdir(), 'squeal-process-names-'));
const runtime = join(root, 'versions', '0.1.366', 'dist', 'cli');
mkdirSync(runtime, { recursive: true });
const script = join(runtime, 'squeal.mjs');
const launcher = join(root, 'squeal');
const executable = join(root, 'squeal-node');
writeFileSync(script, `
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const before = { argv: [...process.argv], argv0: process.argv0, execPath: process.execPath, execArgv: [...process.execArgv] };
if (process.env.PROBE_MODE === 'title') process.title = 'squeal daemon';
if (process.env.PROBE_MODE === 'title-path') process.title = 'squeal ' + process.argv.slice(1).join(' ');
if (process.env.PROBE_MODE === 'comm') writeFileSync('/proc/self/comm', 'squeal-daemon');
const child = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify({argv:process.argv,argv0:process.argv0,title:process.title,execPath:process.execPath}))'], {encoding:'utf8'});
const after = { argv: [...process.argv], argv0: process.argv0, execPath: process.execPath, execArgv: [...process.execArgv] };
console.log(JSON.stringify({before, after, title:process.title, child:JSON.parse(child.stdout)}));
setTimeout(() => process.exit(0), 10000);
`);
writeFileSync(launcher, '#!/bin/sh\nexec "$PROBE_NODE" "$PROBE_SCRIPT" "$@"\n', { mode: 0o755 });
symlinkSync(process.execPath, executable);

const cases = [
  ['direct', process.execPath, [script]],
  ['named-launcher', launcher, []],
  ['named-node-symlink', executable, [script]],
  ['argv0', process.execPath, [script], { argv0: 'squeal' }],
  ['title', process.execPath, [script]],
  ['title-path', process.execPath, [script]],
  ['comm', process.execPath, [script]],
];
const results = [];
try {
  for (const [mode, command, args, options = {}] of cases) {
    const child = spawn(command, [...args, 'daemon', join(root, 'project with spaces'), '--await-lock', '60000'], {
      ...options, env: { ...process.env, PROBE_MODE: mode, PROBE_NODE: process.execPath, PROBE_SCRIPT: script },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const closed = once(child, 'close');
    try {
      let output = '';
      for await (const chunk of child.stdout) {
        output += chunk;
        if (output.includes('\n')) break;
      }
      const js = JSON.parse(output.trim());
      assert.deepEqual(js.after, js.before, mode + ': JS launch state changed');
      assert.equal(js.child.execPath, process.execPath);
      const proc = `/proc/${child.pid}`;
      const cmdline = readFileSync(join(proc, 'cmdline'), 'utf8').split('\0').filter(Boolean);
      const comm = readFileSync(join(proc, 'comm'), 'utf8').trim();
      const stat = readFileSync(join(proc, 'stat'), 'utf8');
      const ps = spawnSync('ps', ['-ww', '-p', String(child.pid), '-o', 'comm=', '-o', 'args='], { encoding: 'utf8' });
      assert.equal(ps.status, 0);
      // Mirror the relevant 0.1.366 discovery preconditions, not a product test.
      const daemonArgs = cmdline.some((a, i) => a === 'daemon' && /(?:^|\/)(?:squeal|squeal\.mjs|squeal\/dist\/cli\/index\.js)$/.test(cmdline[i - 1] ?? ''));
      const retainsVersionPath = ps.stdout.includes(join(root, 'versions', '0.1.366') + '/');
      assert.equal(retainsVersionPath, mode !== 'title');
      assert.equal(daemonArgs, !mode.startsWith('title'));
      if (mode === 'comm') assert.equal(comm, 'squeal-daemon');
      results.push({ mode, comm, statComm: stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')')), exe: readlinkSync(join(proc, 'exe')), cmdline, ps: ps.stdout.trim(), js, discoveryPreconditions: ['MainThread', 'node'].includes(comm) && daemonArgs, discoveryWithNamedComm: ['MainThread', 'node', 'squeal-daemon'].includes(comm) && daemonArgs, retainsVersionPath });
    } finally {
      child.kill('SIGTERM');
      await closed;
    }
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
