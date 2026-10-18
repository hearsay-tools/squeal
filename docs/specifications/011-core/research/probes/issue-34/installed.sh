#!/usr/bin/env bash
# Throwaway: seeds the mixed store with the checkout's code, then reads it with
# the installed CLI (`squeal --version` 0.1.199 on this host) under a temp HOME.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(realpath "$(mktemp -d /tmp/squeal-issue34-installed-XXXXXX)")
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo" "$tmp/home"
timeout 60 node --no-warnings --experimental-transform-types --import ./reg.mjs probe.mjs mixed "$tmp/repo" >/dev/null
# The plugin's own bin/squeal: the ~/.local/bin launcher finds the plugin through HOME.
squeal="${SQUEAL_PLUGIN_BIN:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal}"
echo "installed: $("$squeal" --version)"
(cd "$tmp/repo" && HOME="$tmp/home" timeout 30 "$squeal" status | grep -E "^(Revision|Known failures|Affected checks|Store schema)") || echo "exit $?"
