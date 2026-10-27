// Bounded generated fixtures. Every edit starts from a fresh passing baseline.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { transformSync, version as esbuildVersion } from 'esbuild';
import { hash, selected } from './structural.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2]);
const startLoad = loadavg();
const recorder = resolve(here, '../../../../../../src/runners/observe/recorder.cjs');
mkdirSync(output, { recursive: true });
const base = `export const TAX = 2;
export function shipping(weight) {
  if (weight > 20) return 100;
  return weight * 3;
}
export function tax(amount) { return amount * TAX; }
export function discount(amount) { return amount / 10; }
export function label(value) { return value.toUpperCase(); }
export function cents(amount) { return Math.round(amount * 100); }
export function available(stock) { return stock > 0; }
export function total(items) { return items.reduce((a, b) => a + b, 0); }
export function currency() { return 'USD'; }
export function unused(x) { return 'old'; }
`;
const checks = ['rates.shipping(2), 6', 'rates.tax(10), 20', 'rates.discount(100), 10',
  `rates.label('box'), 'BOX'`, 'rates.cents(1.5), 150', 'rates.available(2), true',
  'rates.total([1, 2]), 3', `rates.currency(), 'USD'`];
const prefix = `import assert from 'node:assert/strict';\nimport * as rates from './rates.mjs';\n`;
const fixtures = [
  { name: 'unchanged', code: base },
  { name: 'body-refactor', code: base.replace('return weight * 3;', 'const rate = 3;\n  return weight * rate;') },
  { name: 'body-regression', code: base.replace('return weight * 3;', 'return weight * 4;') },
  { name: 'insert-branch', code: base.replace('  if (weight > 20)', '  if (weight === 2) return 0;\n  if (weight > 20)') },
  { name: 'uncovered-branch', code: base.replace('return 100;', 'return 101;') },
  { name: 'comments-shift', code: '// comment\n\n' + base },
  { name: 'module-value', code: base.replace('TAX = 2', 'TAX = 3') },
  { name: 'top-level-throw', code: base + `\nthrow Error('added');\n` },
  { name: 'delete-declaration', code: base.replace(`export function currency() { return 'USD'; }\n`, '') },
  { name: 'signature', code: base.replace('unused(x)', 'unused(x, y)'), extra: 'assert.equal(rates.unused.length, 1);' },
  { name: 'reflection', code: base.replace("return 'old'", "return 'new'"), extra: `assert.ok(rates.unused.toString().includes("'old'"));` },
  { name: 'reflection-other-realm', code: base.replace("return 'old'", "return 'new'"), extra: `import vm from 'node:vm';\nconst stringify = vm.runInNewContext('Function.prototype.toString');\nassert.ok(stringify.call(rates.unused).includes("'old'"));` },
  { name: 'data', code: base, extra: `import { readFileSync } from 'node:fs';\nassert.equal(readFileSync(new URL('./rate.txt', import.meta.url), 'utf8'), 'old');`, files: { 'rate.txt': 'new' } },
  { name: 'raw-source-read', code: base.replace("return 'old'", "return 'new'"), extra: `import { readFileSync } from 'node:fs';\nassert.ok(readFileSync(new URL('./rates.mjs', import.meta.url), 'utf8').includes("return 'old'"));` },
  { name: 'data-descriptor', code: base, extra: `import { openSync, readSync, closeSync } from 'node:fs';\nconst fd = openSync(new URL('./rate.txt', import.meta.url));\nconst bytes = Buffer.alloc(3); readSync(fd, bytes); closeSync(fd);\nassert.equal(bytes.toString(), 'old');`, files: { 'rate.txt': 'new' } },
  { name: 'child', code: base.replace("return 'old'", "return 'new'"), extra: `import { execFileSync } from 'node:child_process';\nassert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', "import {unused} from './rates.mjs'; console.log(unused(1))"], {cwd: new URL('.', import.meta.url), encoding:'utf8'}).trim(), 'old');` },
  { name: 'child-spawn', code: base.replace("return 'old'", "return 'new'"), extra: `import { spawnSync } from 'node:child_process';\nassert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', "import {unused} from './rates.mjs'; console.log(unused(1))"], {cwd: new URL('.', import.meta.url), encoding:'utf8'}).stdout.trim(), 'old');` },
  { name: 'syntax', code: base.replace("return 'old';", 'return (;') },
  { name: 'stale-dependency', code: base.replace("return 'old'", "return 'new'"), extra: `import { enabled } from './gate.mjs';\nassert.equal(enabled ? rates.unused(1) : 'old', 'old');`, files: { 'gate.mjs': 'export const enabled = true;\n' } },
  { name: 'stale-source-evidence', code: base.replace('return weight * 3;', 'return weight * 4;'), corrupt: 'sourceHash' },
  { name: 'stale-provider-evidence', code: base.replace('return weight * 3;', 'return weight * 4;'), corrupt: 'epoch' },
  { name: 'missing-coverage', code: base.replace('return weight * 3;', 'return weight * 4;'), corrupt: 'coverage' },
  { name: 'test-edit', code: base, files: { 'test-0.mjs': prefix + 'assert.equal(rates.shipping(2), 7);\n' } },
  { name: 'unkeyed-environment', code: base, extra: `assert.equal(process.env.PROBE_MODE, 'old');`, env: { PROBE_MODE: 'new' } },
];
for (let i = 1; i <= 4; i++) fixtures.push({ ...fixtures.find(f => f.name === 'body-refactor'), name: `body-refactor-repeat-${i}` });
for (const kind of ['body-refactor', 'body-regression', 'comments-shift']) {
  fixtures.push({ ...fixtures.find(f => f.name === kind), name: `typescript-${kind}`, typescript: true });
}
function run(root, tests, mode, env = {}) {
  const start = performance.now();
  let processCpuMs = 0;
  const results = tests.map(test => {
    const observedDir = join(root, '.observed');
    rmSync(observedDir, { recursive: true, force: true });
    mkdirSync(observedDir);
    const preload = mode === 'recorded' ? ['--require', recorder] : [];
    const p = spawnSync('python3', [join(here, 'timed_node.py'), process.execPath, ...preload, join(here, 'js-runner.mjs'), root, test, mode], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, PROBE_MODE: 'old', ...(mode === 'recorded' ? { SQUEAL_OBSERVE: JSON.stringify({ out: observedDir, root, file: join(root, test), skip: [] }) } : {}), ...env }, maxBuffer: 2e6,
    });
    if (p.status !== 0) throw Error(`${test}: ${p.stderr || p.error}`);
    const value = JSON.parse(p.stdout);
    value.squealObserved = readdirSync(observedDir).flatMap(path => readFileSync(join(observedDir, path), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
    value.squealObserved = value.squealObserved.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Array.isArray(v) ? v.map(path => path.slice(root.length + 1)) : v === join(root, test) ? test : v])));
    // This is test-execution CPU in the parent test process, not child/startup CPU.
    processCpuMs += (value.executeCpu.user + value.executeCpu.system) / 1000;
    return { test, ...value };
  });
  return { wallMs: performance.now() - start, childWallMs: results.reduce((sum, r) => sum + r.childWallMs, 0), processTreeCpuMs: results.reduce((sum, r) => sum + r.processTreeCpuMs, 0), testProcessCpuMs: processCpuMs, results };
}
const results = [];
for (const fixture of fixtures) {
  const root = mkdtempSync(join(tmpdir(), 'selection-js-'));
  try {
    const compile = code => fixture.typescript ? transformSync(code.replaceAll('(weight)', '(weight: number)'), { loader: 'ts', format: 'esm', target: 'es2022' }).code : code;
    const previous = { 'rates.mjs': compile(base), 'rate.txt': 'old', 'gate.mjs': 'export const enabled = false;\n' };
    const tests = checks.map((check, i) => {
      const test = `test-${i}.mjs`;
      previous[test] = prefix + `let sum = 0; for (let i = 0; i < 2000000; i++) sum += i;\nassert.equal(${check});\n`;
      return test;
    });
    if (fixture.extra) { tests.push('test-extra.mjs'); previous['test-extra.mjs'] = prefix + fixture.extra; }
    for (const [path, content] of Object.entries(previous)) writeFileSync(join(root, path), content);
    const baseline = run(root, tests, 'coverage');
    const existingBaseline = run(root, tests, 'recorded');
    if (existingBaseline.results.some(r => r.failure)) throw Error('recorder changed baseline outcome');
    if (baseline.results.some(r => r.failure)) throw Error(`${fixture.name}: baseline failed ${JSON.stringify(baseline)}`);
    const records = baseline.results.map(r => ({ ...r, epoch: 'one', sourceHash: hash(previous['rates.mjs']),
      inputs: [...new Set([r.test, ...r.observations.reads, ...r.coverage.map(s => s.url.slice(s.url.lastIndexOf('/') + 1))])] }));
    if (fixture.corrupt) for (const record of records) record[fixture.corrupt] = fixture.corrupt === 'coverage' ? [] : 'invalid';
    const next = { ...previous, 'rates.mjs': compile(fixture.code), ...fixture.files };
    const existingRecords = existingBaseline.results.map(record => ({ ...record, epoch: 'one', sourceHash: hash(previous['rates.mjs']), observations: { reads: [], reflection: false, child: false },
      inputs: [...new Set([record.test, ...record.squealObserved.flatMap(row => row.f ?? [])])],
      childInputs: [...new Set(record.squealObserved.flatMap(row => row.d ?? []))] }));
    if (fixture.corrupt) for (const record of existingRecords) record[fixture.corrupt] = fixture.corrupt === 'coverage' ? [] : 'invalid';
    const start = performance.now();
    const raw = selected({ previous, next, records, guarded: false });
    const guarded = selected({ previous, next, records });
    const existing = selected({ previous, next, records: existingRecords });
    const selectionMs = performance.now() - start;
    for (const [path, content] of Object.entries(next)) writeFileSync(join(root, path), content);
    const reduced = run(root, guarded.tests, 'coverage', fixture.env);
    const existingReduced = run(root, existing.tests, 'recorded', fixture.env);
    const exhaustive = run(root, tests, 'plain', fixture.env);
    const failures = exhaustive.results.filter(r => r.failure).map(r => r.test);
    const missed = selection => failures.filter(test => !selection.tests.includes(test));
    results.push({ case: fixture.name, typescript: Boolean(fixture.typescript), population: tests.length,
      raw, guarded, existing, failures, existingMissed: missed(existing), rawMissed: missed(raw), guardedMissed: missed(guarded), selectionMs,
      baseline, existingBaseline, reduced, existingReduced, exhaustive });
    console.log(fixture.name, `${guarded.tests.length}/${tests.length}`, 'raw missed', missed(raw), 'guarded missed', missed(guarded), 'existing missed', missed(existing));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
writeFileSync(join(output, 'js-results.json'), JSON.stringify({ metadata: { node: process.version, esbuild: esbuildVersion,
  startLoad, endLoad: loadavg(), cpus: cpus().length, note: 'Cold isolated process per file; processTreeCpuMs includes Node startup and waited-for descendants, excludes Python timer startup. testProcessCpuMs excludes both. No population-wide estimate.' }, cases: results }, null, 2) + '\n');
