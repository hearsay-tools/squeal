// Throwaway probe (spec 028 research). A Jest `runtime` subclass that logs every
// module jest-runtime loads (one Runtime instance per test file), including
// mocks, setup files, JSON and modules reached through moduleNameMapper.
// Output: $OBS_OUT/runtime-<pid>.ndjson, one {test, kind, path} per line.
const fs = require('fs');
const path = require('path');
// The project's own jest-runtime: pnpm does not hoist it, so the caller passes its path.
const mod = require(process.env.OBS_JEST_RUNTIME);
const Base = mod.default ?? mod;
const out = path.join(process.env.OBS_OUT, `runtime-${process.pid}.ndjson`);
const log = (test, kind, p) => fs.appendFileSync(out, JSON.stringify({ test, kind, path: p }) + '\n');
class ObservingRuntime extends Base {
  constructor(...args) {
    super(...args);
    this.__test = args[6];
    // Version-stable hook (Jest 29 and 30): the ScriptTransformer passed in is
    // per test file, and every CJS, ESM and JSON module source passes through it.
    const t = args[3];
    for (const name of ['transform', 'transformAsync', 'transformJson', 'transformSource', 'transformSourceAsync']) {
      const orig = t[name];
      if (typeof orig !== 'function') continue;
      t[name] = (filename, ...rest) => {
        log(this.__test, 'transform', filename);
        return orig.call(t, filename, ...rest);
      };
    }
  }
  _loadModule(localModule, from, moduleName, modulePath, options, registry) {
    log(this.__test, 'load', modulePath);
    return super._loadModule(localModule, from, moduleName, modulePath, options, registry);
  }
  readFile(filename) {
    log(this.__test, 'readFile', filename);
    return super.readFile(filename);
  }
}
module.exports = ObservingRuntime;
