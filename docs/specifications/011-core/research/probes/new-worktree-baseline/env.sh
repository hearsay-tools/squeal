#!/bin/sh
# Isolated environment for 011-299 fixture probes: nothing reaches the real HOME, sockets or permit pool.
# X is the probe root (default $TMPDIR/nw/x); NODE_BIN picks the Node that starts the daemon.
X=${X:-$TMPDIR/nw/x}
NODE_BIN=${NODE_BIN:-/home/agent/.nvm/versions/node/v24.22.1/bin}
exec env -i PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
  LANG=C.UTF-8 HOME=$X/home XDG_CONFIG_HOME=$X/xdg/config XDG_CACHE_HOME=$X/xdg/cache \
  XDG_DATA_HOME=$X/xdg/data XDG_STATE_HOME=$X/xdg/state XDG_RUNTIME_DIR=$X/run \
  TMPDIR=$X/tmp TMP=$X/tmp npm_config_cache=$X/npm-cache PNPM_HOME=$X/pnpm COREPACK_HOME=$X/corepack \
  GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@example.invalid GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@example.invalid \
  "$@"
