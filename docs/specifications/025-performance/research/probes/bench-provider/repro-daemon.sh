#!/usr/bin/env bash
# Throwaway probe for research 025-22, after repro.sh made /home/user/proj-<v>.
# Starts Squeal's daemon from /home/user/plugin-0 in each project, as run-cell.mjs
# does (own HOME and XDG_RUNTIME_DIR, the plugin's bin/squeal), waits, prints the
# daemon log lines about Vitest, and stops it. Usage: repro-daemon.sh float pin
set -uo pipefail
H=/home/user
for v in "$@"; do
  d=$H/proj-$v
  (cd "$d" && [ -d .git ] || { git init -q -b main && git add -A && git -c user.name=b -c user.email=b@example.invalid commit -qm p; })
  home=$H/dh-$v; run=$H/dr-$v
  rm -rf "$home" "$run"; mkdir -p "$home" "$run"; chmod 700 "$run"
  export HOME=$home XDG_RUNTIME_DIR=$run
  (cd "$d" && timeout 120 $H/plugin-0/bin/squeal start 2>&1 | head -5)
  sleep 25
  echo "=== $v daemon log:"
  find "$d/.git/squeal/logs" -name 'daemon-*.log' -exec grep -h -i "vitest\|coverage" {} + | sed "s|$H|~|g" | head
  (cd "$d" && timeout 60 $H/plugin-0/bin/squeal stop >/dev/null 2>&1)
done
