#!/bin/sh
# Throwaway: a new foo.js changes what require("./foo") loads (was foo/index.js),
# though no file in the old loaded set changed. Run in the capability fixture dir.
# Usage: shadow-demo.sh <fixture dir> <probe node dir> <out dir>
set -e
cd "$1"; P=$2; O=$3
run() { rm -rf "$O"; mkdir -p "$O"; LM_OUT=$O NODE_OPTIONS="--import $P/hook-sync-memory.mjs" node --no-warnings --test --test-reporter=dot a.test.mjs >/dev/null; for f in "$O"/*.txt; do cat "$f"; echo; done | grep -o 'fx1/foo[^ ]*' | sort -u | tr '\n' ' '; echo; }
printf 'before: '; run
echo 'module.exports = "foo.js shadows foo/index.js";' > foo.js
printf 'after adding foo.js: '; run
rm foo.js
