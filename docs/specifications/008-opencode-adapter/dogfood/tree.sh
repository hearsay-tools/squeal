#!/bin/sh
# Lists the sandbox HOME and the XDG directories (without package bodies and node_modules), and
# prints OpenCode's global config files, for goal 8. Run as squeal-e2e: sh tree.sh > <file>
D=/home/squeal-e2e/dogfood-008
printf '%s load %s\n' "$(date +%T)" "$(cut -d' ' -f1 /proc/loadavg)"
cd "$D" && find home xdg \( -name node_modules -o -name .npm -o -path '*/squeal/opencode/0.*' -o -name 'opencode.db*' \) -prune -o -print | sort
for f in xdg/config/opencode/*.json*; do echo "== $f"; cat "$f"; echo; done
