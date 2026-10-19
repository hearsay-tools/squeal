#!/usr/bin/env bash
# Throwaway: runs probe.mjs against this checkout's src/ through Node's type
# transform (no build, no node_modules). Prints load first; output to stdout only.
set -euo pipefail
cd "$(dirname "$0")"
echo "load: $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"
for s in zero oldrev; do
  timeout 60 node --no-warnings --experimental-transform-types --import ./reg.mjs probe.mjs "$s"
done
