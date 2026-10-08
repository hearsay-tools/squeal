#!/bin/sh
# Throwaway. Does `--tags-filter '!slow'` skip a file tagged `@module-tag slow`
# before importing it, or after? Each run appends to MARK what was imported.
set -u
SCRATCH=${SCRATCH:?}
D=$SCRATCH/vitest-tags; rm -rf "$D"; cp -r "$(dirname "$0")" "$D"
ln -s "$SCRATCH/squeal/node_modules" "$D/node_modules"
cd "$D"
for f in "" "--tags-filter=!slow" "--tags-filter=slow" "--project=nothing"; do
  : >"$D/mark"; MARK="$D/mark" npx vitest run $f --reporter=json --outputFile="$D/r.json" >/dev/null 2>"$D/err"; rc=$?
  echo "filter='$f' rc=$rc imported=[$(tr '\n' ',' <"$D/mark")] $(node -e 'const r=require(process.argv[1]);console.log(r.testResults.map(t=>t.name.split("/").pop()+":"+t.assertionResults.map(a=>a.status).join("/")).join(" "))' "$D/r.json" 2>/dev/null) $(head -c 200 "$D/err")"
done
