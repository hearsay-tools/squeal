// Throwaway probe (spec 028 research). Freshness inside one long-lived process:
// runs fixture test/one.test.js through runCLI, then after each edit:
// (1) a source edit, (2) a new manual mock added beside a mocked module,
// (3) a jest.config.js edit (moduleNameMapper target). Prints pass/fail per step.
// Usage: node warm-fresh.cjs <installDir>   (fixture copied to <installDir>/fx)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const inst = path.resolve(process.argv[2]);
const fx = path.join(inst, 'fx');
fs.rmSync(fx, { recursive: true, force: true });
execSync(`cp -r ${JSON.stringify(path.join(__dirname, 'fixture'))} ${JSON.stringify(fx)}`);
process.chdir(fx);
const core = require(path.join(inst, 'node_modules/@jest/core'));
const argv = { $0: 'jest', _: [path.join(fx, 'test/one.test.js')], config: path.join(fx, 'jest.config.js'), cacheDirectory: path.join(inst, 'cache-fresh'), runInBand: true, ci: false, silent: true, watchman: false, testNamePattern: 'static' };
const run = async (label, expect) => {
  const { results } = await core.runCLI(argv, [fx]);
  const r = results.testResults[0];
  const msg = r.testExecError?.message ?? r.testResults.find((t) => t.status === 'failed')?.failureMessages[0] ?? '';
  console.log(`${label}: ${results.numFailedTests === 0 && !r.testExecError ? 'pass' : 'fail'} (fresh result: ${expect}) ${msg.split('\n')[0].slice(0, 110)}`);
};
(async () => {
  await run('baseline', 'pass');
  fs.writeFileSync('src/c.js', "module.exports = { fromC: 'EDITED' };\n");
  await run('after source edit', 'fail');
  fs.writeFileSync('src/c.js', "module.exports = { fromC: 'c' };\n");
  await run('after revert', 'pass');
  // util.js has no mock; add one and mock it from the test via a new test file? Simpler:
  // replace the existing manual mock's content (mock edit) - must be seen.
  fs.writeFileSync('src/__mocks__/mocked.js', 'module.exports = { real: "EDITED" };\n');
  await run('after manual-mock edit', 'fail');
  fs.writeFileSync('src/__mocks__/mocked.js', 'module.exports = { real: false };\n');
  fs.mkdirSync('lib2');
  fs.writeFileSync('lib2/util.js', "module.exports = { util: 'lib2' };\n");
  fs.writeFileSync('jest.config.js', fs.readFileSync('jest.config.js', 'utf8').replace("'<rootDir>/lib/$1'", "'<rootDir>/lib2/$1'"));
  await run('after jest.config.js edit', 'fail');
  delete require.cache[require.resolve(path.join(fx, 'jest.config.js'))];
  await run('same, after clearing require.cache', 'fail');
})().catch((e) => { console.error(e); process.exit(1); });
