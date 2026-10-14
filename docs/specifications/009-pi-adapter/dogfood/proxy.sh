#!/bin/sh
# Starts proxy.mjs as squeal-e2e, keeping CLIPROXY_API_KEY (by name, from sudo's
# --preserve-env) and nothing else. Usage, from the agent user:
#   sudo -n --preserve-env=CLIPROXY_API_KEY -u squeal-e2e -H sh .../scripts/proxy.sh <log.jsonl>
set -eu
D=/home/squeal-e2e/dogfood-009
[ "$(id -un)" = squeal-e2e ] || { echo "proxy.sh: must run as squeal-e2e" >&2; exit 1; }
exec env -u SUDO_COMMAND HOME="$D/home" PATH=/opt/squeal-e2e/node24/bin:/usr/bin:/bin \
  node "$D/scripts/proxy.mjs" 47319 "$1"
