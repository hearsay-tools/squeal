#!/bin/sh
# 011-223 probe: run a command with every home under /tmp/fsc223, nothing inherited but PATH, at nice 10.
S=/tmp/fsc223
exec env -i PATH="$PATH" HOME=$S/home XDG_RUNTIME_DIR=$S/xdg XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache XDG_DATA_HOME=$S/data XDG_STATE_HOME=$S/state TMPDIR=$S/tmp CODEX_HOME=$S/home/.codex npm_config_cache=$S/home/.npm PNPM_HOME=$S/home/.pnpm npm_config_store_dir=$S/home/.pnpm-store COREPACK_HOME=$S/home/.corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 "$@"
