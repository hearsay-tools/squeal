// Throwaway probe (spec 028 research). Cost of loading N Jest project configs and
// building their haste maps in one process (what `jest --projects a b ...` or a
// root config with `projects` does). Prints time and RSS after each phase.
// Usage: node multi-project.cjs <repo> <cacheDir> <jest.config>...
const path = require('path');
const [repoArg, cacheDirectory, ...cfgs] = process.argv.slice(2);
const repo = path.resolve(repoArg);
const chain = (names) => names.reduce((from, n) => path.dirname(require.resolve(`${n}/package.json`, { paths: [from] })), repo);
const { readConfigs } = require(chain(['jest', 'jest-cli', '@jest/core', 'jest-config']));
const Runtime = require(chain(['jest', 'jest-cli', '@jest/core', 'jest-runtime'])).default;
const mb = () => Math.round(process.memoryUsage().rss / 1048576);
(async () => {
  require('fs').mkdirSync(cacheDirectory, { recursive: true });
  const t0 = Date.now();
  const { configs } = await readConfigs({ $0: 'jest', _: [], cacheDirectory, watchman: false }, cfgs.map((c) => path.resolve(repo, c)));
  const t1 = Date.now();
  console.log(`configs=${configs.length} read ${t1 - t0} ms rss ${mb()} MB`);
  let files = 0;
  for (const config of configs) {
    const hm = await Runtime.createHasteMap(config, { maxWorkers: 1, resetCache: false, watch: false, watchman: false });
    const { hasteFS } = await hm.build();
    files += hasteFS.getAllFiles().length;
  }
  console.log(`haste maps built ${Date.now() - t1} ms, ${files} files indexed, rss ${mb()} MB, total ${Date.now() - t0} ms`);
})().catch((e) => { console.error(e); process.exit(1); });
