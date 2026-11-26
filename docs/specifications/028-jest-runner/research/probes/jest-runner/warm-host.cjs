// Throwaway probe (spec 028 research). Runs test files repeatedly inside one
// long-lived Node process, two ways, and prints wall time and RSS per call:
//   cli:   @jest/core runCLI() per call (re-reads config, rebuilds haste map)
//   sched: config, haste map, context and resolver built once; per call only
//          createTestScheduler().scheduleTests() (the public @jest/core API)
// Usage: node warm-host.cjs <cli|sched> <repo> <jest.config> <cacheDir> <file>...
const path = require('path');
const [mode, repoArg, cfg, cacheDirectory, ...files] = process.argv.slice(2);
// Absolute: readConfigs treats a relative project path as a second project.
const repo = path.resolve(repoArg);
const chain = (names) => names.reduce((from, n) => path.dirname(require.resolve(`${n}/package.json`, { paths: [from] })), repo);
const coreDir = chain(['jest', 'jest-cli', '@jest/core']);
const core = require(coreDir);
const { readConfigs } = require(chain(['jest', 'jest-cli', '@jest/core', 'jest-config']));
const Runtime = require(chain(['jest', 'jest-cli', '@jest/core', 'jest-runtime'])).default;
const mb = () => Math.round(process.memoryUsage().rss / 1048576);
const argv = { $0: 'jest', _: [], config: path.resolve(repo, cfg), cacheDirectory, runInBand: true, ci: true, silent: true, coverage: false, watchman: false };
(async () => {
  const t0 = Date.now();
  let ctx, globalConfig;
  if (mode === 'sched') {
    const { configs, globalConfig: g } = await readConfigs(argv, [repo]);
    globalConfig = g;
    const config = configs[0];
    const hasteMap = await Runtime.createHasteMap(config, { maxWorkers: 1, resetCache: false, watch: false, watchman: false });
    const { hasteFS, moduleMap } = await hasteMap.build();
    ctx = { config, hasteFS, moduleMap, resolver: Runtime.createResolver(config, moduleMap) };
    console.log(`setup ${Date.now() - t0} ms rss ${mb()} MB`);
  }
  for (const f of files) {
    const abs = path.resolve(repo, f);
    const t = Date.now();
    let summary;
    if (mode === 'cli') {
      const { results } = await core.runCLI({ ...argv, _: [abs], runTestsByPath: true }, [repo]);
      summary = `${results.numPassedTests}/${results.numTotalTests}`;
    } else {
      const scheduler = await core.createTestScheduler(globalConfig, { firstRun: true, previousSuccess: true });
      const results = await scheduler.scheduleTests([{ context: ctx, path: abs }], { isInterrupted: () => false, setState() {} });
      summary = `${results.numPassedTests}/${results.numTotalTests}`;
    }
    console.log(`${mode} ${path.basename(f)} ${Date.now() - t} ms rss ${mb()} MB passed ${summary}`);
  }
  console.log(`total ${Date.now() - t0} ms`);
})().catch((e) => { console.error(e); process.exit(1); });
