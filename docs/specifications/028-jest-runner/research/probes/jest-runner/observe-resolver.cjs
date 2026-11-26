// Throwaway probe (spec 028 research). A Jest `resolver` that wraps the default
// resolver and logs each call. Jest caches resolutions per worker, so this
// sees each (basedir, request) pair once per worker, not once per test file.
const fs = require('fs');
const path = require('path');
const out = path.join(process.env.OBS_OUT, `resolver-${process.pid}.ndjson`);
module.exports = (request, options) => {
  const result = options.defaultResolver(request, options);
  fs.appendFileSync(out, JSON.stringify({ request, basedir: options.basedir, result }) + '\n');
  return result;
};
