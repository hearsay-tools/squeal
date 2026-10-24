#!/bin/sh
# Copies the probe to a scratch directory under /tmp and installs rollup there.
S=${TMPDIR:-/tmp}/pm16-rollup; rm -rf "$S"; mkdir -p "$S"; cp "$(dirname "$0")"/probe.mjs "$S"
cd "$S" && npm init -y >/dev/null && npm i -s rollup@4.65.0 >/dev/null || exit 1
node probe.mjs throw; echo "(exit $?)"
node probe.mjs hang; echo "(exit $?)"
