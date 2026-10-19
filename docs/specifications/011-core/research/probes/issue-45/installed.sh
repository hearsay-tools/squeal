#!/usr/bin/env bash
# Throwaway: seeds each scenario's store with the checkout's code into a temp
# directory, then reads it with installed plugin CLIs under a temp HOME.
# Default: 0.1.222 (the incident) and 0.1.223; SQUEAL_PLUGIN_BINS overrides.
set -euo pipefail
cd "$(dirname "$0")"
cache="$HOME/.claude/plugins/cache/hearsay/squeal"
bins=${SQUEAL_PLUGIN_BINS:-"$cache/0.1.222/bin/squeal $cache/0.1.223/bin/squeal"}
echo "load: $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"
for s in zero oldrev; do
  tmp=$(realpath "$(mktemp -d /tmp/squeal-issue45-installed-XXXXXX)")
  mkdir -p "$tmp/repo" "$tmp/home"
  timeout 60 node --no-warnings --experimental-transform-types --import ./reg.mjs probe.mjs "$s" "$tmp/repo" >/dev/null
  for b in $bins; do
    echo "== scenario $s, installed $("$b" --version)"
    (cd "$tmp/repo" && HOME="$tmp/home" timeout 30 "$b" status | sed '/^$/q') || echo "exit $?"
    (cd "$tmp/repo" && HOME="$tmp/home" timeout 30 "$b" status --json \
      | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("json counts",JSON.stringify(s.counts),"knownFailureCounts",JSON.stringify(s.knownFailureCounts))') || echo "exit $?"
  done
  rm -rf "$tmp"
done
