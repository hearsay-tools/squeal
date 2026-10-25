#!/usr/bin/env bash
# Throwaway (016-19). Scratch clones of squeal (this worktree's HEAD) and cezar
# (/home/agent/projects/cezar HEAD) under $S, with their own HOME, XDG_* and TMPDIR.
# node_modules are hard-link copies (cp -a) of the source checkouts' trees.
set -euo pipefail
S=${S:-/tmp/ip-016-19}
SQUEAL_SRC=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
CEZAR_SRC=/home/agent/projects/cezar
mkdir -p "$S"/{home,run,config,cache,data,state,tmp,out}
chmod 700 "$S/run"
node "$(dirname "$0")/make-recorder.mjs" "$SQUEAL_SRC" "$S/rec"
[ -d "$S/squeal" ] || git clone -q "$SQUEAL_SRC" "$S/squeal"
[ -d "$S/squeal/node_modules" ] || cp -a "$SQUEAL_SRC/node_modules" "$S/squeal/node_modules"
[ -d "$S/cezar" ] || git clone -q "$CEZAR_SRC" "$S/cezar"
for nm in node_modules packages/*/node_modules; do
  [ -d "$CEZAR_SRC/$nm" ] && [ ! -e "$S/cezar/$nm" ] && cp -a "$CEZAR_SRC/$nm" "$S/cezar/$nm"
done
git -C "$S/squeal" log --oneline -1
git -C "$S/cezar" log --oneline -1
