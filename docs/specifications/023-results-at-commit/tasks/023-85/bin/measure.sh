#!/bin/bash
# Row 023-85: first-run re-runs on an empty store, one pass per CLI, on a boat.dev sandbox.
# usage: measure.sh <dir>, which holds repo/ (the branch's tracked files), listing.txt (the
# folder-listing test files) and count.cjs. Writes <dir>/results/<variant>.json and logs.
# Variants: before (the committed plugin bundle, main's build), after (this tree's sources),
# after-b (the same without the unseen-child refusal in src/runners/observe/inputs.ts).
set -u
H=$1
log() { echo "$(date -u +%FT%TZ) $*"; }
mkdir -p "$H/results"
cd "$H/repo" || exit 1
git init -q -b main && git add -A && git -c user.email=probe@example.invalid -c user.name=probe commit -qm probe
pnpm install --frozen-lockfile > "$H/install.log" 2>&1 || { log install failed; exit 1; }
log installed
for v in after after-b; do
  cp -a "$H/repo" "$H/build-$v"
  if [ "$v" = after-b ]; then
    sed -i 's/if ((unseen?.size ?? 0) > 0 || absent === undefined/if (absent === undefined/' \
      "$H/build-$v/src/runners/observe/inputs.ts"
    grep -q 'if (absent === undefined' "$H/build-$v/src/runners/observe/inputs.ts" || { log patch failed; exit 1; }
  fi
  (cd "$H/build-$v" && node_modules/.bin/tsx src/harness/claude-code/build.ts) > "$H/build-$v.log" 2>&1 || { log build $v failed; exit 1; }
  log built $v
done
for v in before after after-b; do
  if [ "$v" = before ]; then cli="$H/repo/plugins/claude-code/dist/cli/squeal.mjs"; else cli="$H/build-$v/plugins/claude-code/dist/cli/squeal.mjs"; fi
  rm -rf "$H/clone-$v"; cp -a "$H/repo" "$H/clone-$v"; cd "$H/clone-$v" || exit 1
  log "pass $v: $(node "$cli" --version 2>&1 | head -1)"
  node "$cli" start > "$H/start-$v.log" 2>&1
  start=$(date +%s)
  # shellcheck disable=SC2046
  timeout 3300 node "$cli" status --wait 3200000 $(cat "$H/listing.txt") > "$H/ask-$v.txt" 2>&1
  echo "exit $? after $(( $(date +%s) - start )) s" >> "$H/ask-$v.txt"
  timeout 700 node "$cli" status --wait 600000 > "$H/idle-$v.txt" 2>&1
  node "$cli" status --full > "$H/full-$v.txt" 2>&1
  node "$H/count.cjs" .git/squeal/store.sqlite "$H/clone-$v" "$H/listing.txt" "$v" > "$H/results/$v.json"
  node "$cli" stop > "$H/stop-$v.log" 2>&1
  log "pass $v done: $(tail -1 "$H/ask-$v.txt")"
done
log all done
touch "$H/results/done"
