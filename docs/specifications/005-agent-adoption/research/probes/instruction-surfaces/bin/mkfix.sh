#!/usr/bin/env bash
# Throwaway: a fresh fixture at /tmp/r52/runs/<label>, committed, with its
# instruction file built from fixture/BASE.md plus conditions/<cond>.md.
#   mkfix.sh <label> <cond> <claude|codex> [noplugin]
# cond "a" adds no block. With the plugin, the daemon is started and a
# full-suite checkpoint completed before the session (the daemon is warm).
# "noplugin": the repository is set up for Squeal but this user's harness has
# no plugin, so no daemon is started.
set -e; source "$(dirname "$0")/env.sh"
L=$1; C=$2; H=$3; NP=${4:-}
D=$R/runs/$L; rm -rf "$D"; mkdir -p "$D"; cd "$D"
cp -a "$PROBES/fixture/." .; rm BASE.md
cp -a $R/nm/node_modules node_modules
F=$([ "$H" = codex ] && echo AGENTS.md || echo CLAUDE.md)
{ cat "$PROBES/fixture/BASE.md"; [ -f "$PROBES/conditions/$C.md" ] && { echo; cat "$PROBES/conditions/$C.md"; }; } > "$F"
git init -q; $SQ init --harness codex > /dev/null
git add -A; git commit -qm init
if [ -z "$NP" ]; then $SQ start > /dev/null; $SQ run --all --wait | grep -E "^(Known|Full)"; fi
echo "$D ($F)"
