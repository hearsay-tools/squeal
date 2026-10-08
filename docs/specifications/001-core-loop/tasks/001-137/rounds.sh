#!/usr/bin/env bash
# Task 001-137 evidence, not product code. Alternating rounds of nine.ts on a
# cezar clone, every cezar command with each CEZ_* variable unset and its cwd
# in the clone. Order per pair alternates (on off, off on, ...) so neither
# mode always runs first. Each round's output: <label>-<pair>-<mode>.{json,log}.
# Usage: rounds.sh <clone> <out dir> <first pair> <last pair> <maxWorkers> <label>
set -u
clone=$1; out=$2; first=$3; last=$4; workers=$5; label=$6
here=$(cd "$(dirname "$0")" && pwd)
tsx=$here/../../../../../node_modules/.bin/tsx
unset_cez=$(env | grep -o '^CEZ_[A-Z_]*' | sed 's/^/-u /' | tr '\n' ' ')
nine="packages/cezar/src/application-update/service.test.ts packages/cezar/src/artifacts/cli.test.ts packages/cezar/src/autosave-timeout.test.ts packages/cezar/src/ci-wait/process.test.ts packages/cezar/src/discovery/cli.test.ts packages/cezar/src/git-worktree-lock.test.ts packages/cezar/src/server-install/platforms/ubuntu-vps.test.ts packages/cezar/src/server/repo-branches-api.test.ts packages/cezar/src/server/worktrees-api.test.ts"
mkdir -p "$out"
for i in $(seq "$first" "$last"); do
  if [ $((i % 2)) -eq 1 ]; then order="on off"; else order="off on"; fi
  for mode in $order; do
    # Its own session: a round killed from outside ends alone, logged as killed.
    (cd "$clone" && env $unset_cez setsid -w "$tsx" "$here/nine.ts" "$clone" "$mode" "$out/$label-$i-$mode.json" "$workers" $nine) > "$out/$label-$i-$mode.log" 2>&1
    status=$?
    if [ -f "$out/$label-$i-$mode.json" ]; then tail -1 "$out/$label-$i-$mode.log"; else echo "$mode: pair $i killed or failed, exit $status at $(date -u +%FT%TZ)"; fi
  done
done
