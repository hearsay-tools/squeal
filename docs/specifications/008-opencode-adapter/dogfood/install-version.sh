#!/bin/sh
# 008-37, from the agent user: runs <version>'s install.sh (the full install) as the dogfood
# user through as-user.sh, reading the archive make-archive.sh wrote, and appends the
# transcript with the time, load, install record and `squeal --version` to
# logs/install-<version>.txt. Usage: sh install-version.sh <version>
set -eu
V=$1
D=/home/squeal-e2e/dogfood-008
as() { sudo -n -u squeal-e2e -H sh "$D/scripts/as-user.sh" "$@"; }
{
  date -u +%FT%TZ
  echo "load $(cut -d' ' -f1 /proc/loadavg)"
  echo "\$ SQUEAL_SOURCE=file://$D/src sh $D/src/install-$V.sh"
  as env SQUEAL_SOURCE="file://$D/src" sh "$D/src/install-$V.sh" 2>&1
  echo "exit $?"
  echo "\$ cat xdg/state/squeal/installed"
  sudo -n -u squeal-e2e cat "$D/xdg/state/squeal/installed"
  echo "\$ ls xdg/data/squeal/opencode; readlink current"
  sudo -n -u squeal-e2e ls "$D/xdg/data/squeal/opencode"
  sudo -n -u squeal-e2e readlink "$D/xdg/data/squeal/opencode/current"
  echo "\$ squeal --version"
  as squeal --version 2>&1
} | sudo -n -u squeal-e2e tee -a "$D/logs/install-$V.txt"
