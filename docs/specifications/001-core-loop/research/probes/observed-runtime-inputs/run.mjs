// THROWAWAY probe driver. node run.mjs <vitestPkgDir> <root> <pool> <isolate:true|false> <mode:execArgv|none> [files...]
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const [vitestDir, rootArg, pool, isolate, mode, ...files] = process.argv.slice(2);
const root = resolve(rootArg);
const observe = resolve(import.meta.dirname, 'recorder/observe.cjs');
const out = mkdtempSync(join(tmpdir(), 'ori-obs-'));
const { createVitest } = await import(pathToFileURL(join(resolve(vitestDir), 'dist/node.js')).href);
const opts = { root, watch: false, reporters: [{}], pool, isolate: isolate === 'true' };
if (mode !== 'none') process.env.SQUEAL_OBSERVE_DIR = out;
if (mode === 'execArgv') opts.execArgv = ['--require', observe];
if (mode === 'rootEnv') opts.env = { NODE_OPTIONS: `--require ${observe} ${process.env.NODE_OPTIONS ?? ''}`.trim() };
if (mode === 'nodeOptions') process.env.NODE_OPTIONS = `--require ${observe} ${process.env.NODE_OPTIONS ?? ''}`.trim();
const t0 = performance.now();
const vitest = await createVitest('test', opts);
await vitest.standalone();
if (mode === 'projectExecArgv') for (const p of vitest.projects) p.config.execArgv = [...(p.config.execArgv ?? []), '--require', observe];
console.error('project execArgv:', JSON.stringify(vitest.projects.map((p) => [p.name, p.config.execArgv])));
const specs = (await vitest.globTestSpecifications()).filter((s) => files.length === 0 || files.some((f) => s.moduleId.includes(f)));
await vitest.runTestSpecifications(specs);
const ms = performance.now() - t0;
const states = vitest.state.getTestModules?.().map((m) => `${relative(root, m.moduleId)}:${m.state()}`) ?? [];
await vitest.close();
const per = new Map();
let events = 0;
for (const f of readdirSync(out)) for (const line of readFileSync(join(out, f), 'utf8').split('\n')) {
  if (!line) continue; events++;
  const e = JSON.parse(line);
  if (!e.path.startsWith(root + '/') || e.path.includes('/node_modules/')) continue;
  const t = e.test ? relative(root, e.test) : '(none)';
  const m = per.get(t) ?? new Map(); per.set(t, m);
  const rel = relative(root, e.path);
  const kinds = m.get(rel) ?? new Set(); kinds.add(e.kind + (e.tid ? `@t${e.tid}` : '') + (e.pid !== undefined ? '' : '')); m.set(rel, kinds);
}
console.log(JSON.stringify({ pool, isolate, mode, ms: Math.round(ms), specs: specs.length, events, out, states }));
for (const [t, m] of [...per].sort()) {
  console.log(`  ${t}`);
  for (const [p, k] of [...m].sort()) if (p !== t) console.log(`    ${p}  [${[...k].join(',')}]`);
}
process.exit(0);
