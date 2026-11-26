#!/usr/bin/env bash
# Throwaway probe (spec 028 research). Runs the fixture under Jest with three
# observers at once: Squeal's recorder (NODE_OPTIONS), a wrapping resolver and
# an observing runtime. Usage: run-observe.sh <installDir> <out> [jest args...]
# <installDir> holds node_modules with jest; the fixture is copied to <installDir>/fx.
set -u
here=$(cd "$(dirname "$0")" && pwd)
squeal=$(cd "$here/../../../../../.." && pwd)
inst=$1 out=$2; shift 2
rm -rf "$inst/fx" "$out"; mkdir -p "$out"; cp -r "$here/fixture" "$inst/fx"
fx="$inst/fx"
settings=$(node -e 'console.log(JSON.stringify({out:process.argv[1],root:process.argv[2],file:process.argv[3]??undefined,started:true}))' "$out" "$fx" "${OBS_FILE:-}")
cd "$fx"
cat > jest.observe.config.js <<CFG
module.exports = { ...require('./jest.config.js'), runtime: '$here/observe-runtime.cjs', resolver: '$here/observe-resolver.cjs' };
CFG
OBS_JEST_RUNTIME=$(node "$here/resolve-runtime.cjs" "$fx") OBS_OUT="$out" SQUEAL_OBSERVE="$settings" \
NODE_OPTIONS="--require $squeal/src/runners/observe/recorder.cjs" \
"$inst/node_modules/.bin/jest" --cacheDirectory="$out/../cache-$(basename "$inst")" --ci \
  --config jest.observe.config.js "$@" 2>&1 | grep -E '^(PASS|FAIL|Tests:)|●' 
node "$here/summarize.cjs" "$out" "$fx"
