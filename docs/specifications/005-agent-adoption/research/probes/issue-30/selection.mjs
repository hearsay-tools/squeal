// Throwaway research probe. No runner, daemon, database or browser is started.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { cpus, loadavg } from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

const load = loadavg()[0];
const cpuCount = cpus().length;
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, load1: load, cpuCount }));
if (load > cpuCount) {
  console.log(`NOT REPRODUCED: load ${load} exceeds ${cpuCount} CPUs; live probe skipped.`);
  process.exit(0);
}
const installed = '/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs';
const root = process.cwd();
const unit = 'packages/cezar/src/workflows/ci-wait-refusal.test.ts';
const second = 'packages/cezar/src/workflows/destruction-results.test.ts';
const source = 'packages/cezar/src/workflows/ci-wait-refusal.ts';
const browsers = Array.from({ length: 83 }, (_, i) => `packages/web/e2e/browser-${String(i + 1).padStart(2, '0')}.e2e.ts`);
const ref = (p) => ({ project: p.includes('/e2e/') ? 'browser' : 'server', path: p });
const rows = [unit, second, ...browsers].map((p) => ({ testFile: ref(p), key: `key:${p}` }));
// Synthetic stored closures model inputs: browser files -> packages/cezar/src/**.
// Ordinary imports make source a dependency of unit. All closures are local and valid.
const records = rows.map(({ testFile }) => ({
  testFile, updatedBy: 'probe',
  closure: { paths: testFile.project === 'browser' ? [unit, second, source] : testFile.path === unit ? [source] : [] },
}));
const store = { testFileKeys: { list: () => rows }, testFiles: { list: () => records } };
const targets = [
  ['installed-0.1.199', installed],
  ['checkout-source-0.1.208', 'src/cli/status-wait-paths.ts'],
  ['checkout-bundle-0.1.208', 'plugins/claude-code/dist/cli/squeal.mjs'],
];
const oldBundle = readFileSync(installed, 'utf8');
const identity = oldBundle.match(/function testFileId\([^]*?\n\}/)[0];
for (const [label, file] of targets) {
  const text = readFileSync(file, 'utf8');
  console.log(JSON.stringify({ label, file, sha256: createHash('sha256').update(text).digest('hex') }));
  let code;
  const context = { ...path, realpathSync };
  if (file.endsWith('.ts')) {
    code = stripTypeScriptTypes(text.slice(text.indexOf('export function selectNamedFiles('), text.indexOf("/** Spec 005 D2's path form"))).replace('export function', 'function');
  } else {
    const section = text.slice(text.indexOf('// src/cli/status-wait-paths.ts'));
    code = section.slice(section.indexOf('function selectNamedFiles('), section.indexOf('async function waitForNamed('));
    for (const match of section.slice(0, section.indexOf('function selectNamedFiles(')).matchAll(/(realpathSync|isAbsolute|relative|resolve|sep) as (\w+)/g)) {
      context[match[2]] = match[1] === 'realpathSync' ? realpathSync : path[match[1]];
    }
  }
  const select = runInNewContext(`${identity}\n${code}\nselectNamedFiles`, context);
  const cases = [['exact-unit', [unit]], ['exact-second', [second]], ['source', [source]], ['mixed', [unit, source]], ['unmatched', ['missing.ts']]];
  for (const [name, paths] of cases) {
    const result = select(store, 'probe', root, root, paths);
    const selected = result.files.map((f) => f.path);
    const browserCount = selected.filter((p) => browsers.includes(p)).length;
    const old = label.startsWith('installed');
    const expectedCount = name === 'unmatched' ? 0 : name.startsWith('exact') ? (old ? 84 : 1) : 84;
    assert.equal(selected.length, expectedCount);
    assert.equal(browserCount, name === 'unmatched' || (name.startsWith('exact') && !old) ? 0 : 83);
    if (name === 'exact-unit' || name === 'exact-second') assert.ok(selected.includes(paths[0]));
    assert.equal(result.unmatched.length, name === 'unmatched' ? 1 : 0);
    console.log(JSON.stringify({ case: name, named: paths, selectedCount: selected.length, browserCount, selectedServer: selected.filter((p) => !browsers.includes(p)), unmatched: result.unmatched }));
  }
}
console.log('PASS: 15 selector cases; installed expands exact tests, checkout source and bundle do not. No daemon started.');
