// Throwaway, bounded component probe. No daemon, build, install or test suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { oxlintProvider } from '../../../../../../src/core/lint/provider/oxlint/provider.js';
import { lintCounts } from '../../../../../../src/core/commit/lint.js';
import { commitReportText } from '../../../../../../src/core/commit/text.js';
import { lintEntryLine } from '../../../../../../src/core/lint/surface/format.js';
import { lintTransition } from '../../../../../../src/core/lint/transition.js';
import { blobHash } from '../../../../../../src/core/hash/blob.js';

const repo = resolve(import.meta.dirname, '../../../../../..');
const cezar = process.env.ISSUE_219_CEZAR ?? '/home/user/projects/cezar';
const helperPath = join(cezar, 'packages/cezar/src/ast-grep-rules.testkit.ts');
assert.equal(createHash('sha256').update(readFileSync(helperPath)).digest('hex'),
  '7d9f90b979a8eb112d29c3d572749d733307670c575dda96af433a82fa1463ad', 'Repository helper changed; re-pin before repeating');
const helper = await import(pathToFileURL(helperPath).href);
const file = 'packages/cezar/src/workflows/issue-219.test.ts';
const execute = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
};
const load = loadavg()[0];
if (load > cpus().length) {
  console.log(JSON.stringify({ skipped: true, load, cpus: cpus().length }));
  process.exit(0);
}

// This is the fixture's lint command: the real rule and real baseline comparator,
// restricted to one file. It is not the original repository's full lint command.
if (process.argv[2] === '--repository-lint') {
  const root = process.argv[3];
  const scan = execute(helper.resolveBinary(), ['scan', '--rule', join(import.meta.dirname, 'active-run-literal.yml'), '--json=compact', file], root);
  assert.equal(scan.code, 0, scan.stderr);
  const sites = JSON.parse(scan.stdout).map(match => ({
    file: match.file, rule: match.ruleId, site: match.text.split('\n')[0].trim(), line: match.range.start.line + 1,
  }));
  const diff = helper.compareToBaseline(helper.tally(sites), []);
  console.log(JSON.stringify({ matches: sites.length, added: diff.added }));
  process.exit(diff.added.length ? 1 : 0);
}

const root = mkdtempSync(join(tmpdir(), 'squeal-issue-219-'));
const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const lintCommand = [process.execPath, '--import', join(repo, 'node_modules/tsx/dist/loader.mjs'), join(import.meta.dirname, 'run.mts'), '--repository-lint', root].map(shellQuote).join(' ');
put('package.json', JSON.stringify({ private: true, type: 'module', scripts: { lint: lintCommand } }));
put('squeal.config.json', JSON.stringify({ lint: { enabled: true, tools: ['oxlint'] } }));
put('.oxlintrc.json', JSON.stringify({ rules: { 'no-unused-vars': 'error' } }));
mkdirSync(join(root, 'node_modules'));
symlinkSync(join(repo, 'node_modules/oxlint'), join(root, 'node_modules/oxlint'));
const provider = oxlintProvider({ root, env: { PATH: process.env.PATH }, guardMs: 5000 });
const results = [];
let previous = null;
try {
  const declaration = await provider.open();
  assert.equal('off' in declaration, false);
  await provider.refresh('none');
  for (const [name, text, expectedOxlint, expectedRepository] of [
    ['both-fail-control', 'type ActiveRun = { a: number };\nexport const run: ActiveRun = { a: 1 };\nconst unusedIssue219 = 1;\n', 1, 1],
    ['scope-mismatch', 'type ActiveRun = { a: number };\nexport const run: ActiveRun = { a: 1 };\n', 0, 1],
    ['both-pass-control', 'type ActiveRun = { a: number };\nfunction createActiveRun(): ActiveRun { return { a: 1 }; }\nexport const run = createActiveRun();\n', 0, 0],
  ]) {
    assert.ok(loadavg()[0] <= cpus().length, 'Host load rose above CPU count; stop probing');
    put(file, text);
    const inputs = await provider.inputs([file]);
    assert.ok(inputs.has(file), 'File must actually be covered');
    const run = await provider.lint([{ path: file, text }]);
    assert.equal('off' in run, false);
    const judged = run.results.get(file);
    assert.ok(judged && 'findings' in judged);
    assert.equal(judged.findings.length, expectedOxlint);
    const change = lintTransition(previous, judged.findings);
    previous = judged.findings;
    const blob = blobHash(Buffer.from(text), 'sha1');
    const state = { check: { kind: 'lint', path: file, tool: 'oxlint' }, outcome: expectedOxlint ? 'fail' : 'pass', stale: false,
      judged: { blob, outcome: expectedOxlint ? 'fail' : 'pass' } };
    // Explicit synthetic commit view of real provider output; no store or HEAD watcher.
    const counts = lintCounts({ states: [state], wholeProgram: () => false, segmentHolds: () => false,
      findings: () => judged.findings.length, inputs: () => ({ files: [], installed: false }) },
      { committed: new Map([[file, blob]]), changed: new Set([file]), differing: new Set(), environment: false });
    const summary = commitReportText({ commit: 'abcdef0123456789', revision: 1, at: 1,
      tests: { files: 0, failures: 0, notDetermined: 0, running: 0, unknown: 0 }, lint: counts });
    const repositoryLint = execute('pnpm', ['run', 'lint'], root);
    assert.equal(repositoryLint.code, expectedRepository, repositoryLint.stderr);
    results.push({ name, oxlint: judged.findings, counts, summary,
      transition: change ? lintEntryLine({ path: file, tool: 'oxlint', findings: judged.findings.length, ...change }) : null,
      repositoryLint });
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, load, cpus: cpus().length,
    squeal: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version, declaration,
    astGrep: execute(helper.resolveBinary(), ['--version'], root), results }, null, 2));
} finally {
  await provider.close();
  rmSync(root, { recursive: true, force: true });
}
