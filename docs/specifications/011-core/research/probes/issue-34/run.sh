#!/usr/bin/env bash
# Throwaway: runs probe.mjs against this checkout's src/ through Node's type
# transform (no build, no node_modules). Output goes to stdout only.
set -euo pipefail
cd "$(dirname "$0")"
for s in incident mixed; do
  timeout 60 node --no-warnings --experimental-transform-types --import ./reg.mjs probe.mjs "$s"
done
