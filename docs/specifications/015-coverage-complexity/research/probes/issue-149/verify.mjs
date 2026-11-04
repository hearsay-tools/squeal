// Offline audit of saved issue-149 evidence; starts no daemon or test suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const result = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
assert.equal(result.cases.length, 4);
const summary = result.cases.map(c => {
  assert.ok(c.load.load1 <= c.load.cpus);
  assert.ok(c.launchLoad.load1 <= c.launchLoad.cpus);
  assert.equal(c.daemonExit, 0);
  for (const cmd of c.commands) assert.equal(cmd.exit, 0, JSON.stringify(cmd));
  const report = JSON.parse(c.commands.find(cmd => cmd.command.includes('--json')).stdout);
  assert.equal(report.functions.length, 1);
  const fn = report.functions[0];
  assert.equal(fn.complexity, 1);
  if (c.name === 'excluded') assert.deepEqual(fn.coverage, { excluded: true });
  else {
    const direct = c.name === 'in-process';
    assert.equal(fn.coverage.uncovered, direct ? 'pass' : 'fail');
    assert.equal(fn.coverage.crap.value, direct ? 1 : 2);
    assert.equal(fn.coverage.testFiles, direct ? 1 : 0);
  }
  return { name:c.name, load1:c.load.load1, coverage:fn.coverage, daemonExit:c.daemonExit };
});
console.log(JSON.stringify({ node:result.node, vitest:result.vitest, commit:result.commit, summary },null,2));
