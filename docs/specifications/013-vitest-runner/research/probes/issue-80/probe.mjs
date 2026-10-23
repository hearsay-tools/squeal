// Throwaway issue-80 probe. No product files or existing daemons are changed.
// Usage: node probe.mjs <absolute shipped squeal.mjs> [single|projects|web] [runtime dir name, default .runtime]
// web = projects layout, environment jsdom, .tsx sources (the issue's packages/web shape).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('.', import.meta.url));
const cli = process.argv[2];
const layout = process.argv[3] ?? 'single';
if (!cli) throw new Error('Pass an absolute shipped squeal.mjs path');
const runtime = process.argv[4] ?? '.runtime';
const root = join(base, runtime, `fixture-${layout}-${Date.now()}`);
const pkg = layout === 'single' ? '' : 'packages/web/';
const ext = layout === 'web' ? 'tsx' : 'ts';
const environment = layout === 'web' ? ", environment: 'jsdom'" : '';
const versions = Object.fromEntries(['vitest', 'vite', 'jsdom'].map(p => { try { return [p, JSON.parse(readFileSync(join(base, runtime, 'node_modules', p, 'package.json'), 'utf8')).version]; } catch { return [p, null]; } }));
console.log(JSON.stringify({ timestamp: new Date().toISOString(), node: process.version, cpus: cpus().length, load: loadavg(), layout, runtime, versions, root }));
if (loadavg()[0] > cpus().length) { console.log('SKIPPED: one-minute load exceeds CPU count'); process.exit(0); }
const put = (path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
put('.gitignore', 'node_modules/\n');
put('package.json', '{"name":"issue-80-probe","private":true,"type":"module"}\n');
put('squeal.config.json', JSON.stringify({ runner: { tierSize: 1 }, baseline: { onStart: 'lookup-only' } }));
if (layout !== 'single') {
  put('vitest.config.ts', `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { projects: ['packages/web'], maxWorkers: 1 } });\n`);
  put(`${pkg}vitest.config.ts`, `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { name: 'web', include: ['src/**/*.test.ts']${environment} } });\n`);
} else {
  put('vitest.config.ts', `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['src/**/*.test.ts'], maxWorkers: 1 } });\n`);
}
// Case A: new module written first, importer edited next (issue order, separate revisions).
// Case B: new module and importer edit in one write burst (one revision).
// Case C: importer edited to import a missing module first, the module created after.
// Case D: importer written 200 ms before the module in one burst (importer first).
// Case E: as C, but the run is asked for right after the create, racing it; the final status is read after.
for (const c of ['a', 'b', 'c', 'd', 'e']) {
  put(`${pkg}src/${c}/scroller.${ext}`, `export const value = () => 1;\n`);
  put(`${pkg}src/${c}/scroller.test.ts`, `import { test, expect } from 'vitest';\nimport { value } from './scroller';\ntest('${c} value', () => { expect(value()).toBe(1); });\n`);
}
const importer = c => `import { extra } from './navigation';\nexport const value = () => extra();\n`;
const created = `export const extra = () => 1;\n`;
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(GIT_|VITEST|SQUEAL_|CEZ)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
env.XDG_CONFIG_HOME = join(root, '.probe-config');
const git = args => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture']);
function run(args) {
  console.log('$ node ' + cli + ' ' + args.join(' '));
  try { const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 120000 }); console.log(out); return 0; }
  catch (e) { console.log(e.stdout?.toString(), e.stderr?.toString()); return e.status; }
}
function cold(label) {
  const bin = join(base, runtime, 'node_modules', '.bin', 'vitest');
  console.log(`$ vitest run (cold, ${label})`);
  try { const out = execFileSync(bin, ['run', '--reporter=dot'], { cwd: root, env: { ...env, CI: '1' }, encoding: 'utf8', timeout: 120000 }); console.log(out.split('\n').filter(l => /Test Files|Tests|Failed to resolve/.test(l)).join('\n')); return 0; }
  catch (e) { console.log((e.stdout ?? '').toString().split('\n').filter(l => /Test Files|Tests|Failed to resolve|FAIL/.test(l)).join('\n')); return e.status; }
}
const daemon = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cli, 'daemon', root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let daemonLog = ''; daemon.stdout.on('data', x => daemonLog += x); daemon.stderr.on('data', x => daemonLog += x);
const exited = new Promise(resolve => daemon.once('exit', (code, signal) => resolve({ code, signal })));
const verdicts = {};
// Each write settles into its own revision before a run is asked for, so no checkpoint races the write.
const settle = async () => { await sleep(1500); run(['status', '--wait', '60000']); };
try {
  await sleep(2500);
  console.log('DAEMON_PID', daemon.pid);
  verdicts.warmup = run(['run', '--all', '--wait']);
  console.log('== Case A: create module, wait, then edit importer');
  put(`${pkg}src/a/navigation.${ext}`, created);
  await settle();
  put(`${pkg}src/a/scroller.${ext}`, importer('a'));
  await settle();
  verdicts.a = run(['run', '--all', '--wait']);
  console.log('== Case B: create module and edit importer in one burst');
  put(`${pkg}src/b/navigation.${ext}`, created);
  put(`${pkg}src/b/scroller.${ext}`, importer('b'));
  await settle();
  verdicts.b = run(['run', '--all', '--wait']);
  console.log('== Case C: import a missing module, then create it');
  put(`${pkg}src/c/scroller.${ext}`, importer('c'));
  await settle();
  verdicts.cMissing = run(['run', '--all', '--wait']);
  put(`${pkg}src/c/navigation.${ext}`, created);
  await settle();
  verdicts.c = run(['run', '--all', '--wait']);
  console.log('== Case D: importer written 200 ms before the module');
  put(`${pkg}src/d/scroller.${ext}`, importer('d'));
  await sleep(200);
  put(`${pkg}src/d/navigation.${ext}`, created);
  await settle();
  verdicts.d = run(['run', '--all', '--wait']);
  console.log('== Case E: missing import, then create raced by a run request');
  put(`${pkg}src/e/scroller.${ext}`, importer('e'));
  await settle();
  verdicts.eMissing = run(['run', '--all', '--wait']);
  put(`${pkg}src/e/navigation.${ext}`, created);
  verdicts.eRaced = run(['run', '--all', '--wait']);
  await settle();
  verdicts.e = run(['run', '--all', '--wait']);
  run(['status']);
  verdicts.cold = cold('after all cases');
  console.log('VERDICTS', JSON.stringify(verdicts));
} finally {
  run(['stop']);
  const end = await Promise.race([exited, sleep(10000).then(() => null)]);
  if (!end) { daemon.kill('SIGTERM'); await exited; }
  console.log('DAEMON_EXIT', JSON.stringify(end));
  console.log('DAEMON_LOG', daemonLog);
  console.log('FINAL_LOAD', JSON.stringify(loadavg()));
}
