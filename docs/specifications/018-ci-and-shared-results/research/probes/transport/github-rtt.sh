#!/usr/bin/env bash
# Throwaway (018-14). What one network step to GitHub costs from this host, read-only:
# `git ls-remote` of a ref prefix (what a reader runs to list exports), a one-commit
# fetch into an empty repository (protocol overhead of a fetch), and the download of
# the 2 MB trial export through `gh run download` (bandwidth for 2 MB from GitHub).
# Refuses timing above load = CPUs. Usage: github-rtt.sh <work dir under $TMPDIR> [reps=5]
set -euo pipefail
. "$(dirname "$0")/common.sh"
load=$(cut -d' ' -f1 /proc/loadavg); awk -v l="$load" -v c="$(nproc)" 'BEGIN{exit !(l>c)}' && { echo "load $load: no timing"; exit 2; }
echo "load $load"
W=$1; R=${2:-5}; U=https://github.com/hearsay-tools/cezarion; rm -rf "$W"; mkdir -p "$W"; cd "$W"
for i in $(seq "$R"); do
  t=$(ms); n=$(git ls-remote "$U" 'refs/squeal/*' 'refs/notes/*' | wc -l); a=$(( $(ms)-t ))
  rm -rf e; git init -q e; t=$(ms); git -C e fetch -q --no-write-fetch-head --depth=1 --filter=tree:0 "$U" refs/heads/main; b=$(( $(ms)-t ))
  rm -rf d; t=$(ms); GIT_CONFIG_GLOBAL= gh run download 42596322864 -R hearsay-tools/cezarion -D d >/dev/null; c=$(( $(ms)-t ))
  echo "run $i: ls-remote ($n refs) $a ms; one-commit fetch $b ms; 2 MB artifact download $c ms ($(du -b d/*/* | cut -f1) bytes)"
done
echo "load after $(cut -d' ' -f1 /proc/loadavg)"
