#!/bin/sh
# Runs "$@" as the dogfood user: squeal-e2e, with HOME, TMPDIR and the four XDG directories inside
# /home/squeal-e2e/dogfood-008 and a PATH whose only harness is opencode (claude, codex and pi are
# in squeal-e2e's npm prefix, which is not on it). Every inherited variable is dropped first,
# CLIPROXY_API_KEY included: OpenCode never holds the key, the logging proxy (proxy.mjs) adds it.
#   sudo -n -u squeal-e2e -H sh /home/squeal-e2e/dogfood-008/scripts/as-user.sh [-C <dir>] <command>...
set -eu
cwd=/
if [ "${1:-}" = -C ]; then cwd=$2; shift 2; fi
D=/home/squeal-e2e/dogfood-008
[ "$(id -un)" = squeal-e2e ] || { echo "as-user.sh: must run as squeal-e2e" >&2; exit 1; }
for name in $(awk 'BEGIN { for (k in ENVIRON) if (k ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print k }'); do
  unset "$name" 2>/dev/null || true
done
export HOME="$D/home" TMPDIR="$D/tmp" USER=squeal-e2e LOGNAME=squeal-e2e SHELL=/bin/bash
export XDG_CONFIG_HOME="$D/xdg/config" XDG_DATA_HOME="$D/xdg/data" XDG_CACHE_HOME="$D/xdg/cache" XDG_STATE_HOME="$D/xdg/state"
export PATH="$D/home/.local/bin:$D/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 LANG=C.UTF-8 TERM=xterm-256color
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
cd "$cwd"
exec "$@"
