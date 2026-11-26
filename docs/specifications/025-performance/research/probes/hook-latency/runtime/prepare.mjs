// Throwaway: generate probe-only copies; never overwrite product or test files.
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
const root = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
mkdirSync(out, { recursive: true });
const rewrite = (text, base) => text.replace(/from "(\.[^"]+)"/g, (_, p) => `from "${resolve(base, p).replace(/\.js$/, '.ts')}"`);
if (process.env.PROBE_TRACE) {
  cpSync(join(root, 'plugins/claude-code/dist'), join(out, 'dist'), { recursive: true });
  for (const file of readdirSync(join(out, 'dist')).filter(f=>f.endsWith('.mjs'))) {
    const path = join(out, 'dist', file);
    writeFileSync(path, readFileSync(path, 'utf8').replace('await runMain(', 'globalThis.__sqLoaded=performance.now(); await runMain('));
  }
}
const helper = join(root, 'test/harness/bundle-helpers.ts');
let h = rewrite(readFileSync(helper, 'utf8'), dirname(helper));
if (process.env.PROBE_TRACE) h = h.replace('process.env.SQUEAL_TEST_DIST ?? PLUGIN_DIST', JSON.stringify(join(out, 'dist')));
h = h.replace('const child = spawn(process.execPath, args, {', `
      const mode = process.env.PROBE_MODE ?? 'direct';
      const trace = process.env.PROBE_TRACE;
      const extra = {};
      let command = process.execPath;
      let argv = [...args];
      if (mode === 'cache' || mode === 'launcher' || mode === 'proxy') extra.NODE_COMPILE_CACHE = process.env.PROBE_CACHE;
      if (mode === 'launcher' || mode === 'proxy') {
        command = join(process.env.PROBE_PLUGIN, 'hooks/run');
        argv.unshift(process.execPath);
      }
      if (mode === 'proxy') extra.NODE_USE_ENV_PROXY = '1';
      if (trace) {
        const name = args.at(-1).split('/').at(-1) + '-' + Date.now();
        extra.PROBE_LOG = join(trace, name + '.json');
        argv = ['--import', process.env.PROBE_INSTRUMENT, '--cpu-prof', '--cpu-prof-dir=' + trace, '--cpu-prof-name=' + name + '.cpuprofile', ...args];
        argv = ['-f', ...(process.env.PROBE_SUMMARY ? ['-c'] : ['-tt', '-T']), '-o', join(trace, name + (process.env.PROBE_SUMMARY ? '.strace-c' : '.strace')), process.execPath, ...argv];
        command = 'strace';
        if (process.env.PROBE_PHASE) { command=process.execPath; argv=['--import',process.env.PROBE_INSTRUMENT,...args]; }
      }
      const child = spawn(command, argv, {`);
h = h.replace('HOME: process.env.HOME ?? "", ...env', 'HOME: process.env.HOME ?? "", ...env, ...extra');
writeFileSync(join(out, 'bundle-helpers.ts'), h);
for (const [label, rel] of [['claude', 'test/harness/latency.test.ts'], ['codex', 'test/harness/codex/latency.test.ts'], ['pi', 'test/harness/pi/latency.test.ts'], ['opencode', 'test/harness/opencode/latency.test.ts'], ['antigravity', 'test/harness/antigravity/latency.test.ts']]) {
  const source = join(root, rel);
  if (!readFileSafe(source)) continue;
  let text = rewrite(readFileSync(source, 'utf8'), dirname(source));
  text = text.replaceAll(join(root, 'test/harness/bundle-helpers.ts'), join(out, 'bundle-helpers.ts'));
  // Record p50 for OpenCode too. Keep the original assertions and sampling.
  if (label === 'opencode') text = text.replace('opencodeP95: Math.round(p95(oc)),', 'opencodeP50: Math.round([...oc].sort((a,b)=>a-b)[Math.floor(oc.length/2)]), opencodeP95: Math.round(p95(oc)),');
  if (label === 'claude') text = text.replace('samples.push(out.ms);', 'samples.push(out.ms); console.log(JSON.stringify({probe: true, hook:c.name ?? c.hook, run, ms:out.ms}));');
  if (process.env.PROBE_TRACE && !process.env.PROBE_PHASE) text = text.replace('const RUNS = 20;', 'const RUNS = 1;').replace('const ROUNDS = 3;', 'const ROUNDS = 1;').replace('const BUDGET_MS = 80;', 'const BUDGET_MS = 10000;');
  writeFileSync(join(out, label + '.test.ts'), text);
}
writeFileSync(join(out, 'vitest.config.mjs'), `export default {define:{__SQUEAL_VERSION__: JSON.stringify('0.1.590')},test:{include:['${out}/*.test.ts'],fileParallelism:false, maxWorkers:1, testTimeout:400000}};`);

function readFileSafe(path) { try { return readFileSync(path, 'utf8'); } catch { return null; } }
