#!/bin/sh
# Copies the probe to a scratch directory under /tmp and installs eslint there.
set -e
S=${TMPDIR:-/tmp}/pm16-eslint; rm -rf "$S"; mkdir -p "$S"; cp "$(dirname "$0")"/*.mjs "$S"
cd "$S" && npm init -y >/dev/null && npm i -s eslint@10.13.0 >/dev/null && node probe.mjs
