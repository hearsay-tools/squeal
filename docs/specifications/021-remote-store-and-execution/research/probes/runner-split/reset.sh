#!/usr/bin/env bash
# Throwaway (row 021-04): put the fixture back at its last commit on both sides.
set -euo pipefail
. "$(dirname "$0")/env.sh"
git -C "$FIXTURE" checkout -q -- . && git -C "$FIXTURE" clean -qfd -e node_modules
rsync -a --delete --exclude node_modules --exclude .git -e "$SSHW" "$FIXTURE/" "remote:$REMOTE_ROOT/"
