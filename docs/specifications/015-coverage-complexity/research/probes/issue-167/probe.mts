// Throwaway triage probe. Run from the repository root with pnpm exec tsx.
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileCondition } from '../../../../../../src/core/code/crap/file.js';
import { joinCoverage } from '../../../../../../src/core/code/crap/join.js';
import { crapScore } from '../../../../../../src/core/code/crap/score.js';
const host = { at: new Date().toISOString(), load: loadavg(), cpus: cpus().length };
if (host.load[0] > host.cpus) {
  console.log(JSON.stringify({ skipped: 'one-minute load exceeds CPU count', host }));
  process.exit(0);
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const condition = fileCondition([], true);
const notListed = fileCondition([], false);
const joined = joinCoverage([{ range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 } }], []);
assert.equal(condition.state, 'ready');
assert.equal(notListed.state, 'pending');
assert.equal(joined[0].coverage, 0);
assert.equal(joined[0].ran, false);
assert.equal(crapScore(7, joined[0].coverage), 56);
assert.equal(crapScore(7, 0.95), 7);
const cli = [];
for (const args of [['code', '--help'], ['quality', '--json'], ['code', 'src/core/code/crap/score.ts', '--json']]) {
  const before = { at: new Date().toISOString(), load: loadavg(), cpus: cpus().length };
  if (before.load[0] > before.cpus) { cli.push({ args, before, skipped: true }); continue; }
  const result = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', ...args], { encoding: 'utf8', timeout: 20000 });
  cli.push({ command: ['pnpm', 'exec', 'tsx', 'src/cli/index.ts', ...args], before,
    exit: result.status, signal: result.signal, error: result.error?.message,
    stdout: result.stdout, stderr: args[0] === 'quality' ? result.stderr.split('\n')[0] : result.stderr });
}
assert.equal(cli[0].exit, 0);
assert.equal(cli[1].exit, 2);
console.log(JSON.stringify({ host, version: pkg.version, node: process.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  condition, notListed, joined, crapAtZeroCC7: crapScore(7, 0), crapAt95CC7: crapScore(7, 0.95), cli }, null, 2));
