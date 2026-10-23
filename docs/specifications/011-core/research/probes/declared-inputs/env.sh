#!/bin/sh
# Isolated environment for 011-150 probes: nothing reaches the real HOME.
S=/tmp/di150
exec env -i PATH="/home/agent/.nvm/versions/node/v24.21.0/bin:/usr/local/bin:/usr/bin:/bin" \
  LANG=C.UTF-8 HOME=$S/home XDG_CONFIG_HOME=$S/xdg/config XDG_CACHE_HOME=$S/xdg/cache \
  XDG_DATA_HOME=$S/xdg/data XDG_STATE_HOME=$S/xdg/state XDG_RUNTIME_DIR=$S/run \
  TMPDIR=$S/tmp TMP=$S/tmp npm_config_cache=$S/npm-cache npm_config_offline=true PNPM_HOME=$S/pnpm COREPACK_HOME=$S/corepack "$@"
