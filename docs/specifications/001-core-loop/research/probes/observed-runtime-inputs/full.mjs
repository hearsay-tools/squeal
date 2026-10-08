// THROWAWAY probe: run a Vitest suite with or without the recorder, write per-file durations,
// observed paths and the post-run Vite import closure to <outJson>.
// node full.mjs <root> <mode:none|projectExecArgv> <outJson> [fileSubstring...]
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir, loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
const [rootArg, mode, outJson, ...files] = process.argv.slice(2);
const root = resolve(rootArg);
const observe = resolve(import.meta.dirname, 'recorder/observe.cjs');
const out = mkdtempSync(join(tmpdir(), 'ori-full-'));
if (mode !== 'none') process.env.SQUEAL_OBSERVE_DIR = out;
const { createVitest } = await import(pathToFileURL(join(root, 'node_modules/vitest/dist/node.js')).href);
const load0 = loadavg()[0];
const vitest = await createVitest('test', { root, watch: false, reporters: [{}] });
await vitest.standalone();
if (mode === 'projectExecArgv') for (const p of vitest.projects) p.config.execArgv = [...(p.config.execArgv ?? []), '--require', observe];
const specs = (await vitest.globTestSpecifications()).filter((s) => s.pool !== 'typescript' && (files.length === 0 || files.some((f) => s.moduleId.includes(f))));
const t0 = performance.now();
await vitest.runTestSpecifications(specs);
const wallMs = performance.now() - t0;
const modules = {};
for (const m of vitest.state.getTestModules()) {
  const rel = relative(root, m.moduleId);
  const seen = new Set(); const stack = Object.values(m.project.vite.environments).map((env) => env.moduleGraph.getModuleById(m.moduleId)).filter(Boolean);
  while (stack.length) { const n = stack.pop(); if (!n.file || seen.has(n.file)) continue; seen.add(n.file); for (const c of n.importedModules) stack.push(c); }
  const failures = [...m.children.allTests()].filter((t) => t.result().state === 'failed').map((t) => `${t.fullName}: ${String(t.result().errors?.[0]?.message ?? '').slice(0, 300)}`);
  modules[rel] = { failures, state: m.state(), duration: m.diagnostic().duration, project: m.project.name, imports: [...seen].filter((f) => f.startsWith(root + '/') && !f.includes('/node_modules/')).map((f) => relative(root, f)) };
}
await vitest.close();
let events = 0, bytes = 0;
const observed = {};
for (const f of readdirSync(out)) {
  const text = readFileSync(join(out, f), 'utf8'); bytes += text.length;
  for (const line of text.split('\n')) {
    if (!line) continue; events++;
    const e = JSON.parse(line);
    const t = e.test ? relative(root, e.test) : '(none)';
    const m = (observed[t] ??= {});
    const rel = e.path.startsWith(root + '/') ? relative(root, e.path) : e.path;
    (m[rel] ??= []).includes(e.kind) || m[rel].push(e.kind);
  }
}
writeFileSync(outJson, JSON.stringify({ mode, specs: specs.length, wallMs, load0, load1: loadavg()[0], events, bytes, procFiles: readdirSync(out).length, modules, observed }));
console.log(JSON.stringify({ mode, specs: specs.length, wallMs: Math.round(wallMs), load0, load1: loadavg()[0], events, bytes }));
process.exit(0);
