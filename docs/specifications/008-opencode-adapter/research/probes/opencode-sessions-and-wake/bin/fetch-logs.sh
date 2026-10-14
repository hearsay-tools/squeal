#!/bin/bash
# Throwaway. Run as the agent user: copies squeal-e2e's probe logs out (they hold ids, never the key).
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$HERE/logs/raw"
cd /
sudo -n -u squeal-e2e tar -C /home/squeal-e2e/008-sessions/log -cf - --exclude='*-beat' . | tar -C "$HERE/logs/raw" -xf -
if grep -rl "${CLIPROXY_API_KEY:-unset-key-guard}" "$HERE/logs/raw" >/dev/null 2>&1; then echo "KEY FOUND IN LOGS" >&2; exit 1; fi
ls "$HERE/logs/raw"
