#!/bin/bash
# Throwaway. The only entry point run as the agent user: sends this probe tree
# to squeal-e2e through tar and runs one probe script there, from cwd /.
# CLIPROXY_API_KEY passes by name only, as 005's as-e2e.mjs does: sudo starts
# from an environment of PATH and that name alone, so `env` needs no -i, and
# the value never enters argv.
# Usage: bin/e2e.sh <script under bin/> [args...]
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd /
for v in $(compgen -e); do
  case $v in PATH|CLIPROXY_API_KEY) ;; *) unset "$v" 2>/dev/null || true ;; esac
done
export PATH=/usr/bin:/bin
E2E=(sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H env HOME=/home/squeal-e2e PATH=/opt/squeal-e2e/node24/bin:/usr/bin:/bin)
tar -C "$HERE" -cf - plugin bin cfgdir | "${E2E[@]}" sh -c 'mkdir -p /home/squeal-e2e/008-sessions/probe && tar -C /home/squeal-e2e/008-sessions/probe -xf -'
script=$1
shift
exec "${E2E[@]}" sh /home/squeal-e2e/008-sessions/probe/bin/"$script" "$@"
