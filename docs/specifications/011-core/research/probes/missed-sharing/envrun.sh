#!/bin/sh
# 011-152 probe: run a command with every home under /tmp/ms152, nothing inherited but PATH.
S=/tmp/ms152
exec env -i PATH="$PATH" HOME=$S/home XDG_RUNTIME_DIR=$S/xdg XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache XDG_DATA_HOME=$S/data XDG_STATE_HOME=$S/state TMPDIR=$S/tmp CODEX_HOME=$S/home/.codex npm_config_cache=$S/home/.npm PNPM_HOME=$S/home/.pnpm COREPACK_HOME=$S/home/.corepack nice -n 10 "$@"
