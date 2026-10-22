#!/bin/bash
# The squeal CLI of the squeal clone's committed dist (0.1.265, da73c4984), in the scratch environment.
# Refuses to run outside a clone: the CLI reads the store of the repository it runs in.
case "$PWD/" in /tmp/wm119/repos/*) ;; *) echo "sq.sh: run it inside a /tmp/wm119/repos clone, not $PWD" >&2; exit 2 ;; esac
source "$(dirname "$0")/env.sh"
exec node /tmp/wm119/repos/squeal-s/plugins/claude-code/dist/cli/squeal.mjs "$@"
