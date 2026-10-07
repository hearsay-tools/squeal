import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cpus, availableParallelism, loadavg } from 'node:os';
import { fixture } from './fixture.mjs';
const base = fileURLToPath(new URL('.', import.meta.url));
const node = process.argv[2] ?? process.execPath;
const version = (await launch(['--version'], base)).stdout.trim();
const root = join(base, '.scratch', version);
rmSync(root, { recursive: true, force: true });
fixture(root);
const cwd = join(root, 'packages/demo');
const flags = ['--import', '../../scripts/preload.mjs', '--import', 'tsx'];
const reporter = join(base, 'reporter.mjs');
const output = { version, tsx: '4.21.0', nodeOptions: 'launcher sets NODE_OPTIONS empty; host proxy warnings still observed', platform: process.platform, arch: process.arch, cpu: cpus()[0].model, availableParallelism: availableParallelism(), loadavg: loadavg(), cases: {} };
function launch(args, cwd, env = {}, limit = 8000) {
  return new Promise(resolve => {
    const start = performance.now();
    const child = spawn(node, args, { cwd, env: { ...process.env, NODE_OPTIONS: '', ...env }, detached: true });
    let stdout = '', stderr = '', watchdog = false;
    child.stdout.on('data', b => stdout += b);
    child.stderr.on('data', b => stderr += b);
    const timer = setTimeout(() => { watchdog = true; process.kill(-child.pid, 'SIGKILL'); }, limit);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, watchdog, wallMs: performance.now() - start, stdout, stderr }); });
  });
}
function normalize(value) { return JSON.parse(JSON.stringify(value).replaceAll(root, '<fixture>').replaceAll(base.slice(0,-1), '<probe>')); }
function parse(text) {
  return text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return [{ type: 'probe:raw', data: line }]; } });
}
function summarize(events) {
  return {
    eventTypes: [...new Set(events.map(e => e.type))],
    results: events.filter(e => ['test:pass', 'test:fail'].includes(e.type)).map(e => ({ type: e.type, ...e.data })),
    summaries: events.filter(e => e.type === 'test:summary').map(e => e.data),
    fileCompletions: events.filter(e => e.type === 'test:complete' && e.data.details?.type === 'test' && e.data.name?.endsWith('.test.ts') && e.data.nesting === 0).map(e => e.data),
  };
}
async function record(name, args, { env = {}, destination, compact = false, limit } = {}) {
  const result = await launch(args, cwd, env, limit);
  const events = parse(destination ? readFileSync(destination, 'utf8') : result.stdout);
  const data = { args, ...result, ...summarize(events) };
  if (compact) { delete data.stdout; delete data.results; }
  else { data.events = events; delete data.stdout; }
  output.cases[name] = normalize(data);
  console.log(version, name, result.code, result.watchdog ? 'WATCHDOG' : '', Math.round(result.wallMs)+'ms');
  return events;
}
const api = (files, options = {}) => [join(base,'api.mjs'), JSON.stringify({ files, execArgv: flags, ...options })];
const cli = (files, options = []) => [...flags, '--test', '--test-reporter='+reporter, ...options, ...files];
const eventsFile = ['test/unit/events.test.ts'];
await record('api-events', api(eventsFile), { env: { PROBE_ENV: 'assigned' } });
await record('api-events-again', api(eventsFile));
await record('api-filter', api(eventsFile, { testNamePatterns: ['outer pass'] }));
await record('api-filter-none', api(eventsFile, { testNamePatterns: ['IMPOSSIBLE-NAME'] }));
await record('api-source-maps', api(eventsFile, { execArgv: [...flags, '--enable-source-maps'] }));
await record('api-none-execArgv', api(['cases/enum.test.ts'], { isolation: 'none' }));
await record('api-only', api(eventsFile, { only: true }));
await record('api-no-preload', api(eventsFile, { execArgv: [] }));
await record('api-inherited-flags', [...flags, ...api(eventsFile, { execArgv: [] })]);
await record('api-require', api(eventsFile, { execArgv: [...flags, '--require', '../../scripts/require.cjs'] }));
const dest = join(root,'report.jsonl');
await record('cli-destination', cli(eventsFile, ['--test-reporter-destination='+dest]), { destination: dest });
await record('cli-glob-unit', cli(['test/unit/*.test.ts']));
await record('cli-glob-e2e', cli(['test/e2e/*.test.ts']));
await record('api-glob', [join(base,'api.mjs'), JSON.stringify({ globPatterns: ['test/e2e/*.test.ts'], execArgv: flags })]);
for (const kind of ['import','syntax','empty']) {
  await record('api-'+kind, api(['cases/'+kind+'.test.ts']));
  await record('cli-'+kind, cli(['cases/'+kind+'.test.ts']));
}
await record('api-timeout', api(['cases/hang.test.ts'], { timeout: 1500 }));
await record('api-abort', api(['cases/hang.test.ts'], { abortAfter: 1500 }));
await record('cli-timeout', cli(['cases/hang.test.ts'], ['--test-timeout=1500']));
await record('cli-block-timeout', cli(['cases/block.test.ts'], ['--test-timeout=1500']));
await record('api-block-timeout', api(['cases/block.test.ts'], { timeout: 1500 }));
await record('cli-only', cli(eventsFile, ['--test-only']));
await record('cli-dry-run', cli(eventsFile, ['--test-dry-run']));
await record('cli-coverage', cli(['test/e2e/smoke.test.ts'], ['--experimental-test-coverage']));
await record('api-coverage', api(['test/e2e/smoke.test.ts'], { coverage: true }));
await record('cli-snapshot-missing', cli(['cases/snapshot.test.ts']));
await record('cli-snapshot-update', cli(['cases/snapshot.test.ts'], ['--test-update-snapshots']));
await record('cli-snapshot-read', cli(['cases/snapshot.test.ts']));
output.snapshots = readdirSync(join(cwd,'cases')).filter(n => n.includes('snapshot')).map(name => ({name, content:readFileSync(join(cwd,'cases',name),'utf8')}));
await record('cli-native-types', ['--import','../../scripts/preload.mjs','--test','--test-reporter='+reporter,'bench/0.test.ts']);
await record('cli-native-enum', ['--test','--test-reporter='+reporter,'cases/enum.test.ts']);
await record('cli-tsx-enum', cli(['cases/enum.test.ts']));
for (const format of ['tap','spec','junit']) {
  const r = await launch([...flags, '--test', '--test-reporter='+format, ...eventsFile], cwd);
  output.cases['reporter-'+format] = normalize(r);
}
for (const isolation of ['process','none']) {
  writeFileSync(join(cwd,'src/value.ts'), 'export const value: number = 1;\n');
  await record('repeat-'+isolation, [...flags, ...api(['cases/repeat.test.ts'], { isolation, repeat: 2, change: {path: join(cwd,'src/value.ts'), content: 'export const value: number = 2;\n'} })]);
}
writeFileSync(join(cwd,'src/value.ts'), 'export const value: number = 1;\n');
await record('repeat-none-fresh-entry', [...flags, ...api(['cases/repeat.test.ts'], { isolation:'none', repeat:2, freshEntry:true, change:{path:join(cwd,'src/value.ts'),content:'export const value: number = 2;\n'} })]);
writeFileSync(join(cwd,'src/value.ts'), 'export const value: number = 1;\n');
await record('api-watch', api(['cases/repeat.test.ts'], { watch:true, watchProbe:true, abortAfter:2500, change:{path:join(cwd,'src/value.ts'),content:'export const value: number = 2;\n'} }));
writeFileSync(join(cwd,'src/value.ts'), 'export const value: number = 1;\n');
const benchFiles = Array.from({length:20}, (_,i) => 'bench/'+i+'.test.ts');
for (let sample = 0; sample < 3; sample++) {
  for (const concurrency of [1,4,true]) await record(`bench-process-${concurrency}-${sample}`, api(benchFiles, { concurrency }), { compact:true, limit:30000 });
  await record(`bench-none-${sample}`, [...flags, ...api(benchFiles, {isolation:'none'})], {compact:true});
  await record(`bench-one-${sample}`, api([benchFiles[0]]), {compact:true});
  await record(`bench-cli-one-${sample}`, cli([benchFiles[0]]), {compact:true});
}
mkdirSync(join(base,'results'), {recursive:true});
writeFileSync(join(base,'results',version+'.json'), JSON.stringify(output,null,2)+'\n');
