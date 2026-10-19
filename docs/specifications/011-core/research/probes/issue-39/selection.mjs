// Throwaway research probe for gh-39. No runner, daemon, database or browser is started.
// Evaluates the real selectNamedFiles/worktreePath from each target against an in-memory store,
// with a real temporary directory as the worktree root so cwd resolution and realpath run as shipped.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { cpus, loadavg, tmpdir } from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

const load = loadavg()[0];
const cpuCount = cpus().length;
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, load1: load, cpuCount }));
if (load > cpuCount) {
  console.log(`NOT RUN: load ${load} exceeds ${cpuCount} CPUs; probe skipped.`);
  process.exit(0);
}
const cache = '/home/agent/.claude/plugins/cache/hearsay/squeal';
const targets = [
  ['installed-0.1.222', `${cache}/0.1.222/dist/cli/squeal.mjs`],
  ['installed-0.1.199', `${cache}/0.1.199/dist/cli/squeal.mjs`],
  ['checkout-source', 'src/cli/status-wait-paths.ts'],
  ['checkout-bundle', 'plugins/claude-code/dist/cli/squeal.mjs'],
];
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'issue-39-')));
const sub = path.join(root, 'packages/cezar');
mkdirSync(path.join(sub, 'src/core'), { recursive: true });
// The incident's names (cezar at 2a5e7a7fb): two listed unit tests, a source, 81 browser specs
// whose declared inputs include packages/cezar/src/** (resolved to concrete files, as keys/closure.ts does).
const A = 'packages/cezar/src/core/cursor-acp-runner.test.ts';
const B = 'packages/cezar/src/core/cursor-print-capabilities.test.ts';
const S = 'packages/cezar/src/core/cursor-acp-runner.ts';
const browsers = Array.from({ length: 81 }, (_, i) => `packages/web/e2e/b${String(i + 1).padStart(2, '0')}.e2e.ts`);
const ref = (p) => ({ project: p.includes('/e2e/') ? 'browser' : 'cezar', path: p });
function storeOf(listed) {
  const rows = listed.map((p) => ({ testFile: ref(p), key: `key:${p}` }));
  const records = rows.map(({ testFile }) => ({
    testFile, updatedBy: 'probe',
    closure: { paths: testFile.project === 'browser' ? [A, B, S] : testFile.path === A ? [S] : [] },
  }));
  return { testFileKeys: { list: () => rows }, testFiles: { list: () => records } };
}
const full = storeOf([A, B, ...browsers]);
const withoutA = storeOf([B, ...browsers]); // A not listed: what an unlisted or unknown test path reaches
const cases = [
  // [name, cwd, store, args]
  ['A cwd-relative from sub', sub, full, ['src/core/cursor-acp-runner.test.ts']],
  ['A repo-relative from root', root, full, [A]],
  ['A absolute from sub', sub, full, [path.join(root, A)]],
  ['A absolute from root', root, full, [path.join(root, A)]],
  ['B repo-relative from sub (incident 1)', sub, full, [B]],
  ['B cwd-relative from sub', sub, full, ['src/core/cursor-print-capabilities.test.ts']],
  ['A cwd-relative from root (wrong base)', root, full, ['src/core/cursor-acp-runner.test.ts']],
  ['source cwd-relative from sub', sub, full, ['src/core/cursor-acp-runner.ts']],
  ['source repo-relative from root', root, full, [S]],
  ['missing test under src/** from sub', sub, full, ['src/core/missing.test.ts']],
  ['A cwd-relative from sub, A unlisted', sub, withoutA, ['src/core/cursor-acp-runner.test.ts']],
  ['outside worktree from sub', sub, full, ['../../../elsewhere.test.ts']],
];
const identitySrc = readFileSync(`${cache}/0.1.222/dist/cli/squeal.mjs`, 'utf8').match(/function testFileId\([^]*?\n\}/)[0];
const table = {};
for (const [label, file] of targets) {
  const text = readFileSync(file, 'utf8');
  console.log(JSON.stringify({ label, file, sha256: createHash('sha256').update(text).digest('hex') }));
  const context = { ...path, realpathSync };
  let code;
  if (file.endsWith('.ts')) {
    code = stripTypeScriptTypes(text.slice(text.indexOf('export function selectNamedFiles('), text.indexOf("/**\n * Spec 005 D2's path form"))).replace('export function', 'function');
  } else {
    const section = text.slice(text.indexOf('// src/cli/status-wait-paths.ts'));
    code = section.slice(section.indexOf('function selectNamedFiles('), section.indexOf('async function waitForNamed('));
    for (const m of section.slice(0, section.indexOf('function selectNamedFiles(')).matchAll(/(realpathSync|isAbsolute|relative|resolve|sep) as (\w+)/g)) {
      context[m[2]] = m[1] === 'realpathSync' ? realpathSync : path[m[1]];
    }
  }
  const select = runInNewContext(`${identitySrc}\n${code}\nselectNamedFiles`, context);
  for (const [name, cwd, store, args] of cases) {
    const r = select(store, 'probe', root, cwd, args);
    const sel = r.files.map((f) => f.path);
    const out = {
      selected: sel.length,
      browsers: sel.filter((p) => browsers.includes(p)).length,
      units: sel.filter((p) => !browsers.includes(p)),
      unmatched: r.unmatched,
    };
    (table[name] ??= {})[label] = `${out.selected}/${out.browsers}${out.unmatched.length ? ` unmatched=${out.unmatched}` : ''}`;
    console.log(JSON.stringify({ target: label, case: name, cwd: path.relative(root, cwd) || '.', args: args.map((a) => a.replace(root, '<root>')), ...out }));
  }
}
// Assertions on the shipped 0.1.222 behaviour, the checkout and the 0.1.199 difference.
for (const label of ['installed-0.1.222', 'checkout-source', 'checkout-bundle']) {
  for (const n of ['A cwd-relative from sub', 'A repo-relative from root', 'A absolute from sub', 'A absolute from root']) assert.equal(table[n][label], '1/0');
  assert.equal(table['B repo-relative from sub (incident 1)'][label], '0/0 unmatched=packages/cezar/packages/cezar/src/core/cursor-print-capabilities.test.ts');
  assert.equal(table['B cwd-relative from sub'][label], '1/0');
  assert.equal(table['A cwd-relative from sub, A unlisted'][label], '81/81');
}
for (const n of ['A cwd-relative from sub', 'A repo-relative from root', 'A absolute from sub']) assert.equal(table[n]['installed-0.1.199'], '82/81');
rmSync(root, { recursive: true, force: true });
console.log('SUMMARY selected/browsers per case and target:');
console.log(JSON.stringify(table, null, 1));
console.log('PASS: cwd-relative, repo-relative-from-root and absolute forms select the same file on every target; no daemon started.');
