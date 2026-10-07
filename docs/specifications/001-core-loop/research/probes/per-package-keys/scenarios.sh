#!/bin/bash
# Throwaway probe (001-102): for each fixture package, install a v2 of it alone in a scratch copy,
# record which test files fail (ground truth: the outcome changed) and which keys each scheme changes.
set -e
here=$(cd "$(dirname "$0")" && pwd)
scratch=${SCRATCH:-/tmp/ppk/scen}
node "$here/perfile.mjs" /tmp/ppk/perfile-v1.json >/dev/null 2>&1 || (cd "$here/fixture" && node ../perfile.mjs /tmp/ppk/perfile-v1.json >/dev/null)
for pkg in $(ls "$here/pkgsrc"); do
  dir="$scratch/$pkg"; rm -rf "$dir"; mkdir -p "$dir"
  cp -r "$here/fixture" "$dir/fixture"; cp -r "$here/pkgsrc/$pkg" "$dir/src"
  sed -i 's/"version":"1.0.0"/"version":"1.0.1"/' "$dir/src/package.json"
  find "$dir/src" -type f ! -name package.json -exec sed -i 's/-v1/-v2/g' {} +
  (cd "$dir/src" && npm pack --silent --pack-destination "$dir/fixture/tarballs" >/dev/null)
  cd "$dir/fixture"
  node -e '
    const fs=require("fs"),[pkg]=process.argv.slice(1);const p=JSON.parse(fs.readFileSync("package.json"));
    const spec=`file:tarballs/${pkg}-1.0.1.tgz`;p.dependencies[pkg]=spec;if(p.overrides?.[pkg])p.overrides[pkg]=spec;
    fs.writeFileSync("package.json",JSON.stringify(p,null,2));' "$pkg"
  npm install --no-audit --no-fund >/dev/null 2>&1
  node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=/tmp/ppk/res.json >/dev/null 2>&1 || true
  failing=$(node -e 'const r=require("/tmp/ppk/res.json");console.log(r.testResults.filter(t=>t.status!=="passed").map(t=>t.name.split("/fixture/")[1]).sort().join(" "))')
  keys=$(node "$here/compare.mjs" /tmp/ppk/perfile-v1.json "$here/fixture/node_modules/.package-lock.json" node_modules/.package-lock.json)
  echo "$pkg | failing: $failing | $keys"
done
