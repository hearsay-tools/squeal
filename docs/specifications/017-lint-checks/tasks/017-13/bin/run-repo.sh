#!/bin/sh
# Throwaway probe for 017-13. Not product code.
#   sh run-repo.sh <id>...      ids of one repository, run one after another
# For each id: session.mjs <id>, then the clone's daemon is stopped and verify.mjs checks the
# session's lint transitions and final files against a fresh ESLint CLI run (bytes from the
# session's snapshots). The next session's runner resets the clone and starts a daemon again.
set -u
here=$(cd "$(dirname "$0")" && pwd)
W=/tmp/dogfood-017-13/w-4a90e840
R=/home/squeal-e2e/runs/d1713
for id in "$@"; do
  case "$id" in
    s*) repo=saas; flags=v10_config_lookup_from_file ;;
    v*) repo=svelte; flags= ;;
  esac
  base=$(node -e "console.log(require('$W/bases.json').$repo)")
  node "$here/session.mjs" "$id" > "$W/logs/run-$id.out" 2>&1
  chmod -R a+rwX "$W/logs/sessions/$id"
  E2E_VAR_ESLINT_FLAGS=$flags node "$here/as-e2e.mjs" "$R" "$R/$repo" sh -c \
    "squeal stop >/dev/null; node --no-warnings $W/bin/verify.mjs $W/logs/sessions/$id $R/snap/$id $base" \
    > "$W/logs/verify-$id.out" 2>&1
  echo "$id done $(date -u +%T)"
done
