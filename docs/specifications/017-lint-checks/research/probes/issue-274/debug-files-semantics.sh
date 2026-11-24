#!/bin/bash
# Throwaway (issue #274 research). Two questions about `oxlint --debug files`, run in a
# new empty folder given as $1 with an installed oxlint package folder as $2:
#  1. Does it load a JSON config's JS plugin, or a TS config? (a marker file says)
#  2. Does a run with no paths (a "root pass") list what a run with explicit paths lists?
set -eu
dir=$1; ox=$2
mkdir -p "$dir/src/sub" "$dir/gen" "$dir/.hidden" "$dir/node_modules"
cd "$dir"
ln -s "$ox" node_modules/oxlint
echo '{"type":"module"}' > package.json
echo 'export const a = 1;' > src/a.ts
cat > plugin.ts <<'TS'
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PROBE_MARK ?? "/dev/null", `plugin loaded argv=${process.argv.slice(2).join(" ")}\n`);
export default { meta: { name: "local" }, rules: { "x": { create() { appendFileSync(process.env.PROBE_MARK ?? "/dev/null", "rule create\n"); return {}; } } } };
TS
echo '{"jsPlugins":["./plugin.ts"],"rules":{"local/x":"warn"}}' > .oxlintrc.json
B="node node_modules/oxlint/bin/oxlint"
for args in "--debug files --threads 1 -- src/a.ts" "--format json --threads 1 -- src/a.ts" "--print-config --threads 1"; do
  : > mark.log; PROBE_MARK=$PWD/mark.log $B $args > /dev/null || true
  echo "[json config + JS plugin] $args => $(tr '\n' '|' < mark.log)"
done
rm .oxlintrc.json
cat > oxlint.config.ts <<'TS'
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PROBE_MARK ?? "/dev/null", "ts config loaded\n");
export default { rules: { "no-debugger": "error" } };
TS
for args in "--debug files --threads 1 -- src/a.ts" "--format json --threads 1 -- src/a.ts"; do
  : > mark.log; PROBE_MARK=$PWD/mark.log $B $args > /dev/null 2>&1 || true
  echo "[TS config] $args => $(tr '\n' '|' < mark.log)"
done
rm oxlint.config.ts mark.log
echo 'export const g = 1;' > gen/g.ts; echo 'export const h = 1;' > .hidden/h.ts; echo 'export const s = 1;' > src/sub/s.ts
echo '{"ignorePatterns":["gen/**"]}' > .oxlintrc.json
printf 'node_modules\nsrc/sub/\n' > .gitignore
git init -q
echo "-- root pass (no paths):"; $B --debug files --threads 1 | sort
echo "-- explicit paths src/a.ts gen/g.ts .hidden/h.ts src/sub/s.ts:"; $B --debug files --threads 1 -- src/a.ts gen/g.ts .hidden/h.ts src/sub/s.ts | sort
