#!/bin/sh
# 008-37, from the agent user: puts remeda back at its clean commit and settles Squeal's store
# there before a session: `git checkout` of any edit, then a daemon of the installed Squeal for one
# full-suite checkpoint, then `squeal stop`. Appends the transcript, with the UTC time and load,
# to logs/<name>.txt. Usage: sh settle.sh <name>
set -u
D=/home/squeal-e2e/dogfood-008
as() { sudo -n -u squeal-e2e -H sh "$D/scripts/as-user.sh" -C "$D/remeda" "$@"; }
{
  echo "$(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  echo '$ git status --short'; as git status --short
  echo '$ git checkout -- .'; as git checkout -- .
  echo '$ squeal --version'; as squeal --version
  echo '$ squeal start'; as squeal start 2>&1 | head -2
  echo '$ squeal run --all --wait 300000'; as squeal run --all --wait 300000 2>&1 | head -8
  echo '$ squeal stop'; as squeal stop 2>&1
  echo '$ git status --short'; as git status --short
  echo "$(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
} | sudo -n -u squeal-e2e tee -a "$D/logs/$1.txt"
