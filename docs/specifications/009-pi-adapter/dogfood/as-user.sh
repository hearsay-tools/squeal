#!/bin/sh
# Runs "$@" as the dogfood user: squeal-e2e, with HOME, the Pi agent dir and TMPDIR inside
# /home/squeal-e2e/dogfood-009 and a PATH whose only harness is pi (claude and codex are in
# squeal-e2e's npm prefix, which is not on it). Every inherited variable is dropped first,
# CLIPROXY_API_KEY included: Pi never holds the key, the logging proxy (proxy.mjs) adds it.
#   sudo -n -u squeal-e2e -H sh /home/squeal-e2e/dogfood-009/scripts/as-user.sh [-C <dir>] <command>...
set -eu
cwd=/
if [ "${1:-}" = -C ]; then cwd=$2; shift 2; fi
D=/home/squeal-e2e/dogfood-009
[ "$(id -un)" = squeal-e2e ] || { echo "as-user.sh: must run as squeal-e2e" >&2; exit 1; }
for name in $(awk 'BEGIN { for (k in ENVIRON) if (k ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print k }'); do
  unset "$name" 2>/dev/null || true
done
export HOME="$D/home" TMPDIR="$D/tmp" PI_CODING_AGENT_DIR="$D/agent"
export PATH="$D/home/.local/bin:$D/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin"
export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 LANG=C.UTF-8 TERM=xterm-256color
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
cd "$cwd"
exec "$@"
