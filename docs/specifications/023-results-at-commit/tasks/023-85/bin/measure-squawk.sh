#!/bin/bash
# Row 023-85: squawk's two ast-grep lint files on an empty store, one pass per CLI, on the
# sandbox measure.sh prepared (its builds in <m85>). usage: measure-squawk.sh <m85> <dir>,
# <dir>/repo holding squawk at round 11's commit. Writes <dir>/results/<variant>.json.
set -u
M=$1; H=$2
log() { echo "$(date -u +%FT%TZ) $*"; }
mkdir -p "$H/results"
printf '%s\n' packages/cezar/src/lint/lint-ast-grep-1.test.ts packages/cezar/src/lint/lint-ast-grep-2.test.ts > "$H/listing.txt"
cd "$H/repo" || exit 1
[ -d .git ] || { git init -q -b main && git add -A && git commit -qm probe; }
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile > "$H/install.log" 2>&1 || { log install failed; exit 1; }
log installed
for v in before after after-b; do
  if [ "$v" = before ]; then cli="$M/repo/plugins/claude-code/dist/cli/squeal.mjs"; else cli="$M/build-$v/plugins/claude-code/dist/cli/squeal.mjs"; fi
  rm -rf "$H/clone-$v"; cp -a "$H/repo" "$H/clone-$v"; cd "$H/clone-$v" || exit 1
  node "$cli" start > "$H/start-$v.log" 2>&1
  start=$(date +%s)
  # shellcheck disable=SC2046
  timeout 1500 node "$cli" status --wait 1400000 $(cat "$H/listing.txt") > "$H/ask-$v.txt" 2>&1
  echo "exit $? after $(( $(date +%s) - start )) s" >> "$H/ask-$v.txt"
  timeout 700 node "$cli" status --wait 600000 > "$H/idle-$v.txt" 2>&1
  node "$cli" status --full > "$H/full-$v.txt" 2>&1
  node "$M/count.cjs" .git/squeal/store.sqlite "$H/clone-$v" "$H/listing.txt" "$v" > "$H/results/$v.json"
  node "$cli" stop > "$H/stop-$v.log" 2>&1
  log "pass $v done: $(tail -1 "$H/ask-$v.txt")"
done
log all done
touch "$H/results/done"
