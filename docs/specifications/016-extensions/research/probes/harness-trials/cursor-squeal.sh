#!/bin/sh
# Throwaway probe (016-35). Run by Cursor as squeal-e2e: cursor-squeal.sh <bundle>.
# Translates Cursor's payload (cursor-squeal.mjs in), runs Squeal's shipped
# Claude Code bundle as a child of this shell, and translates its answer back
# (cursor-squeal.mjs out). Exits 2 when the bundle did.
set -u
N=/opt/squeal-e2e/node24/bin/node
T=$HOME/ht035/probe/cursor-squeal.mjs
D=$(mktemp -d)
$N "$T" in "$D" >"$D/in"
CLAUDE_PROJECT_DIR=$($N -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).cwd)' "$D/meta") \
  $N --disable-warning=ExperimentalWarning "$HOME/ht035/squeal/plugins/claude-code/dist/$1.mjs" <"$D/in" >"$D/out" 2>"$D/err"
code=$?
$N "$T" out "$D" "$code"
rm -rf "$D"
[ "$code" = 2 ] && exit 2
exit 0
