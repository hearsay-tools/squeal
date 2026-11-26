// Throwaway probe (spec 028 research). Writes a wrapper Jest config (a .cjs file
// outside the project) that loads a project's jest.config.ts unchanged and adds
// overrides: the observing runtime and, optionally, a reporter.
// Usage: node wrap-config.cjs <project jest.config.ts> <out.cjs> [reporter.cjs]
const fs = require('fs');
const path = require('path');
const [cfg, out, reporter] = process.argv.slice(2).map((p) => p && path.resolve(p));
const here = __dirname;
fs.writeFileSync(out, `
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(${JSON.stringify(cfg)});
// Jest itself loads .ts configs through ts-node; do the same, transpile only.
req('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const loaded = req(${JSON.stringify(cfg)});
const c = loaded.default ?? loaded;
const rootDir = path.resolve(${JSON.stringify(path.dirname(cfg))}, c.rootDir ?? '.');
module.exports = {
  ...c,
  rootDir,
  runtime: ${JSON.stringify(path.join(here, 'observe-runtime.cjs'))},
  ${reporter ? `reporters: [${JSON.stringify(reporter)}],` : ''}
};
`);
