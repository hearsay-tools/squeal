#!/usr/bin/env bash
# Throwaway Q2 setup: scratch home /tmp/w0c/home-q2 with the rich squeal-codex plugin installed
# from /tmp/w0c/r-q2, a subdirectory /tmp/w0c/r-q2/pkg/sub, and a second repository
# /tmp/w0c/r-q2-other. Prints the hooks.state TOML inline table (for -c) on stdout.
set -e
B="$(cd "$(dirname "$0")" && pwd)"
export CODEX_HOME=$(bash "$B/home.sh" q2)
R=$(bash "$B/mkrepo.sh" q2 one); mkdir -p "$R/pkg/sub"
bash "$B/mkrepo.sh" q2-other one >/dev/null
codex plugin marketplace add "$R" >/dev/null; codex plugin add squeal-codex@squeal >/dev/null
node "$B/hash.mjs" "$CODEX_HOME/plugins/cache/squeal/squeal-codex/0.1.14/hooks/hooks.json" 'squeal-codex@squeal:hooks/hooks.json' > /tmp/w0c/logs/q2-hashes.txt
printf 'hooks.state={'; sep=''; while read -r k h; do printf '%s"%s"={trusted_hash="%s"}' "$sep" "$k" "$h"; sep=','; done < /tmp/w0c/logs/q2-hashes.txt; printf '}\n'
