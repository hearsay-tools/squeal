#!/usr/bin/env bash
# Throwaway probe (011-35): the guarded files each shipped KEY_FORMAT_VERSION raise covers.
# Reads git only, runs no product code. Window of raise N = the last version
# release carrying N-1 (its tag, or 0.1.219 for the untagged 12) .. the first
# version commit carrying N: the guarded change that forced the raise.
# WINDOWS="$(cat tag-windows.txt)" bash raises.sh gives tag-to-tag windows instead.
# The guarded set is approximated from test/keys/key-sources.ts at 0.1.225:
# GUARDED less EXEMPT plus GUARDED_WITHIN; manifests are checked separately.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
WINDOWS=${WINDOWS:-"
10 squeal--v0.1.168 6c9fed9e
11 squeal--v0.1.199 a6c50b6e
12 squeal--v0.1.215 35abdccc
13 2639208a 87d7ced6
14 squeal--v0.1.222 05958848
15 squeal--v0.1.223 8515e737
16 squeal--v0.1.224 70759ddf
17 squeal--v0.1.225 d3014a3e
"}
guarded() {
  grep -E '^(src/|tsconfig\.json$|plugins/claude-code/bin/)' |
  grep -Ev '^src/core/keys/key-format\.ts$|^src/runners/[^/]+/version\.ts$' |
  grep -Ev '^src/(cli|core/status|core/delivery|harness)/' || true
}
within() { grep -E '^src/cli/(index|main|daemon)\.ts$|^src/harness/(build|claude-code/build|codex/build|pi/build|opencode/build)\.ts$' || true; }
manifest() { # $1 ref $2 path: the manifest less version and devDependencies
  git show "$1:$2" | node -e 'const m=JSON.parse(require("fs").readFileSync(0,"utf8"));delete m.version;delete m.devDependencies;console.log(JSON.stringify(m))'
}
echo "$WINDOWS" | while read -r v a b; do
  [ -z "$v" ] && continue
  files=$(git diff --name-only "$a" "$b")
  g=$( { echo "$files" | guarded; echo "$files" | within; } | sort -u)
  m=""
  for f in package.json plugins/claude-code/package.json; do
    [ "$(manifest "$a" "$f")" != "$(manifest "$b" "$f")" ] && m="$m $f"
  done
  dl=$(git diff "$a" "$b" -- package-lock.json | grep -c '^[-+] *"node_modules/' || true)
  echo "== raise $((v-1))->$v $(git rev-parse --short "$a")..$(git rev-parse --short "$b") src/build files: $(echo "$g" | grep -c . || true); manifests changed beyond version:${m:- none}; lock package lines changed: $dl; +$(git diff --shortstat "$a" "$b" -- $g | sed 's/.*changed, //')"
  echo "$g" | while read -r f; do [ -n "$f" ] && echo "   $(git diff --numstat "$a" "$b" -- "$f" | awk '{print $1"+/"$2"-"}') $f"; done
done
